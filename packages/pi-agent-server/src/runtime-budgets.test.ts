import { expect, test } from 'bun:test';
test('native compaction summarizes within model capacity and retains a durable boundary', async () => {
  const { fixture } = await import('./managed-fallback.fixture.ts');
  await fixture(async f => {
    await f.session.prompt('Source document ' + 'word '.repeat(35000));
    await f.session.prompt('Next part ' + 'word '.repeat(35000));
    await f.session.compact();
    const last = f.requests.at(-1)!.body;
    expect(Number(last.max_tokens ?? last.max_completion_tokens)).toBeGreaterThan(0);
    expect(Number(last.max_tokens ?? last.max_completion_tokens)).toBeLessThanOrEqual(f.session.model!.maxTokens);
    expect(f.session.sessionManager.getEntries().some(entry => entry.type === 'compaction')).toBe(true);
  }, () => {
    const chunks = [{ choices: [{ index: 0, delta: { role: 'assistant', content: 'Summary' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }];
    return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  }, undefined, { catalog: [{ id: 'deepseek-v4-flash', name: 'Fixture', contextWindow: 1000000,
    fallbackCapabilities: { maxOutputTokens: 32768, tools: true, structuredOutput: 'prompt' } } as never] });
});

for (const above of [false, true]) {
  test(`native tool loop ${above ? 'above' : 'below'} native threshold preserves history and settles once`, async () => {
    const { fixture } = await import('./managed-fallback.fixture.ts');
    const { Type } = await import('@sinclair/typebox');
    let loopStarted = false;
    let summaries = 0;
    await fixture(async f => {
      await f.session.prompt('seed ' + 'word '.repeat(35000));
      await f.session.prompt('second ' + 'word '.repeat(35000));
      f.events.length = 0;
      await f.session.prompt('LOOP');
      await f.session.waitForIdle();
      expect(f.events.filter(type => type === 'agent_settled')).toHaveLength(1);
      expect(summaries > 0).toBe(above);
      expect(f.session.sessionManager.getEntries().filter(entry => entry.type === 'message').length).toBeGreaterThan(5);
      expect(f.session.getLastAssistantText()).toBe('Complete');
    }, (_model, _index, body) => {
      const summary = !(body.tools as unknown[] | undefined)?.length;
      if (summary) summaries++;
      const loop = !summary && !loopStarted && JSON.stringify(body.messages).includes('LOOP');
      if (loop) loopStarted = true;
      const delta = loop ? { tool_calls: [{ index: 0, id: 'noop', type: 'function', function: { name: 'noop', arguments: '{}' } }] } : { content: summary ? 'Preserved seed history.' : 'Complete' };
      const usage = { prompt_tokens: loop ? (above ? 990000 : 970000) : 10, completion_tokens: 1, total_tokens: 11 };
      const chunks = [{ choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: loop ? 'tool_calls' : 'stop' }], usage }];
      return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    }, undefined, { tools: [{ name: 'noop', label: 'noop', description: 'Read-only fixture', parameters: Type.Object({}),
      async execute() { return { content: [{ type: 'text', text: 'done' }], details: {} }; } }] });
  });
}

for (const outcome of ['cancel', 'failure', 'empty', 'whitespace'] as const) {
  test(`native summary ${outcome} preserves history and allows the adjacent prompt`, async () => {
    const { fixture, completion } = await import('./managed-fallback.fixture.ts');
    let summarizing = false;
    await fixture(async f => {
      await f.session.prompt('source ' + 'word '.repeat(35000));
      await f.session.prompt('more source ' + 'word '.repeat(35000));
      const before = f.session.sessionManager.getEntries().filter(entry => entry.type === 'message');
      const unsubscribe = f.session.subscribe(event => {
        if (outcome === 'cancel' && event.type === 'compaction_start') queueMicrotask(() => f.session.abortCompaction());
      });
      summarizing = true;
      await expect(f.session.compact()).rejects.toThrow();
      summarizing = false;
      unsubscribe();
      expect(f.session.sessionManager.getEntries().filter(entry => entry.type === 'message')).toEqual(before);
      expect(f.session.sessionManager.getEntries().some(entry => entry.type === 'compaction')).toBe(false);
      expect(JSON.stringify(f.session.messages)).toContain('source word');
      f.events.length = 0;
      await f.session.prompt('Continue after the interrupted summary');
      await f.session.waitForIdle();
      expect(f.session.getLastAssistantText()).toBe('OK');
      expect(f.events.filter(type => type === 'agent_settled')).toHaveLength(1);
    }, async model => {
      if (!summarizing) return completion(model);
      if (outcome === 'empty' || outcome === 'whitespace') {
        return new Response((await completion(model).text()).replace('"content":"OK"',
          `"content":${JSON.stringify(outcome === 'empty' ? '' : ' \n\t ')}`),
          { headers: { 'content-type': 'text/event-stream' } });
      }
      return Response.json({ error: { message: 'summary rejected' } }, { status: 400 });
    });
  });
}

test('native model selection and reload preserve explicit settings', async () => {
  const { fixture, completion } = await import('./managed-fallback.fixture.ts');
  await fixture(async f => {
    const nativeReserve = f.session.settingsManager.getCompactionReserveTokens();
    await f.session.setModel(f.session.modelRuntime.getModel('fixture', 'deepseek-v4-pro')!);
    expect(f.session.settingsManager.getCompactionReserveTokens()).toBe(nativeReserve);
    f.session.settingsManager.setCompactionEnabled(false);
    await f.session.reload();
    await f.session.prompt('After reload');
    expect(f.session.settingsManager.getCompactionEnabled()).toBe(false);
    expect(f.session.settingsManager.getCompactionReserveTokens()).toBe(nativeReserve);
  }, completion, undefined, { candidateContext: 262144 });
});

test('native branch summary rejects blank provider output through the shared validator', async () => {
  const { fixture, completion } = await import('./managed-fallback.fixture.ts');
  const { generateBranchSummary } = await import('@earendil-works/pi-coding-agent');
  let blank = false;
  await fixture(async f => {
    await f.session.prompt('Keep this branch decision.');
    const options = { model: f.session.model!, apiKey: 'loopback-only', signal: new AbortController().signal, streamFn: f.session.agent.streamFn };
    blank = true;
    const failed = await generateBranchSummary(f.session.sessionManager.getBranch(), options);
    expect(failed.error).toContain('summary is empty');
    expect(failed.summary).toBeUndefined();
    blank = false;
    const recovered = await generateBranchSummary(f.session.sessionManager.getBranch(), options);
    expect(recovered.error).toBeUndefined();
    expect(recovered.summary).toContain('OK');
  }, async model => new Response((await completion(model).text()).replace('"content":"OK"',
    `"content":${JSON.stringify(blank ? ' \n ' : 'OK')}`),
    { headers: { 'content-type': 'text/event-stream' } }));
});

test('explicit summary budget caps actual requests without changing native model capacity', async () => {
  const { fixture, completion } = await import('./managed-fallback.fixture.ts');
  await fixture(async f => {
    await f.session.prompt('Original content ' + 'word '.repeat(35000));
    await f.session.prompt('More content ' + 'word '.repeat(35000));
    const capacity = f.session.model!.maxTokens;
    f.session.settingsManager.applyOverrides({ compaction: { maxSummaryTokens: 1024 } });
    await f.session.compact();
    const request = f.requests.at(-1)!.body;
    expect(request.max_tokens ?? request.max_completion_tokens).toBe(1024);
    expect(f.session.model!.maxTokens).toBe(capacity);
  }, completion);
});

for (const outputTokens of [8192, 4096]) {
  test(`length at ${outputTokens} tokens respects the request budget during native recovery`, async () => {
    const { fixture, completion } = await import('./managed-fallback.fixture.ts');
    await fixture(async f => {
      f.session.maxOutputTokens = 8192;
      const stream = f.session.agent.streamFunction;
      f.session.agent.streamFunction = (model, context, options) => stream(model, context, { ...options, maxTokens: 8192 });
      await f.session.prompt('seed ' + 'word '.repeat(35000));
      await f.session.prompt('more ' + 'word '.repeat(35000));
      await f.session.prompt('write at the ordinary budget');
      await f.session.waitForIdle();
      expect(f.session.model?.maxTokens).toBe(32768);
      expect(f.requests[2]!.body.max_tokens ?? f.requests[2]!.body.max_completion_tokens).toBe(8192);
      expect(f.requests).toHaveLength(outputTokens === 8192 ? 3 : 5);
      expect(f.session.getLastAssistantText()).toBe(outputTokens === 8192 ? 'Partial output' : 'OK');
    }, (model, index) => {
      if (index !== 3) return completion(model);
      const chunks = [
        { choices: [{ index: 0, delta: { role: 'assistant', content: 'Partial output' }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'length' }], usage: { prompt_tokens: 88000, completion_tokens: outputTokens, total_tokens: 88000 + outputTokens } },
      ];
      return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    }, undefined, { catalog: [{ id: 'deepseek-v4-flash', name: 'Fixture', contextWindow: 1_000_000,
      fallbackCapabilities: { maxOutputTokens: 32768, tools: true, structuredOutput: 'prompt' } } as never] });
  });
}
