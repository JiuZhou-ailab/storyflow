import { expect, test } from 'bun:test';
import { SettingsManager } from '@earendil-works/pi-coding-agent';
import { applyCompactionDefaults, compactionDefaults } from './runtime-budgets.ts';

test('window-relative defaults recompute and preserve explicit native settings', () => {
  expect(compactionDefaults(1_000_000)).toEqual({ reserveTokens: 200000, keepRecentTokens: 32000 });
  expect(compactionDefaults(262144)).toEqual({ reserveTokens: 52429, keepRecentTokens: 32000 });
  expect(compactionDefaults(8192)).toEqual({ reserveTokens: 1639, keepRecentTokens: 3276 });
  const settings = SettingsManager.inMemory({ compaction: { enabled: false, keepRecentTokens: 1000 } });
  applyCompactionDefaults(settings, 1_000_000);
  applyCompactionDefaults(settings, 262144);
  expect(settings.getCompactionSettings()).toMatchObject({ enabled: false, reserveTokens: 52429, keepRecentTokens: 1000, maxSummaryTokens: 8192 });
  expect(settings.getGlobalSettings().compaction).toEqual({ enabled: false, keepRecentTokens: 1000 });
  applyCompactionDefaults(settings, undefined);
  expect(settings.getCompactionReserveTokens()).toBe(16384);
});

test('native boundary comparison and summary output budget remain independent of reserve space', async () => {
  const { shouldCompact } = await import('@earendil-works/pi-coding-agent');
  const { fixture } = await import('./managed-fallback.fixture.ts');
  for (const window of [1000000, 262144]) {
    const settings = SettingsManager.inMemory();
    applyCompactionDefaults(settings, window);
    expect(shouldCompact(Math.floor(window * 0.8), window, settings.getCompactionSettings())).toBe(false);
    expect(shouldCompact(Math.floor(window * 0.8) + 1, window, settings.getCompactionSettings())).toBe(true);
  }
  await fixture(async f => {
    const { streamSimple } = await import('@earendil-works/pi-ai');
    f.session.agent.streamFunction = streamSimple;
    applyCompactionDefaults(f.session.settingsManager, 1000000);
    await f.session.prompt('Source document ' + 'word '.repeat(35000));
    await f.session.prompt('Next part ' + 'word '.repeat(35000));
    await f.session.compact();
    const last = f.requests.at(-1)!.body;
    expect(last.max_tokens ?? last.max_completion_tokens).toBe(8192);
    expect(f.session.sessionManager.getEntries().some(entry => entry.type === 'compaction')).toBe(true);
  }, () => {
    const chunks = [{ choices: [{ index: 0, delta: { role: 'assistant', content: 'Summary' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }];
    return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  }, undefined, { catalog: [{ id: 'deepseek-v4-flash', name: 'Fixture', contextWindow: 1000000,
    fallbackCapabilities: { maxOutputTokens: 32768, tools: true, structuredOutput: 'prompt' } } as never] });
});

for (const above of [false, true]) {
  test(`native tool loop ${above ? 'above' : 'below'} product threshold preserves history and settles once`, async () => {
    const { fixture } = await import('./managed-fallback.fixture.ts');
    const { Type } = await import('@sinclair/typebox');
    let loopStarted = false;
    let summaries = 0;
    await fixture(async f => {
      applyCompactionDefaults(f.session.settingsManager, 1000000);
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
      const usage = { prompt_tokens: loop ? (above ? 810000 : 790000) : 10, completion_tokens: 1, total_tokens: 11 };
      const chunks = [{ choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: loop ? 'tool_calls' : 'stop' }], usage }];
      return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    }, undefined, { tools: [{ name: 'noop', label: 'noop', description: 'Read-only fixture', parameters: Type.Object({}),
      async execute() { return { content: [{ type: 'text', text: 'done' }], details: {} }; } }] });
  });
}

for (const outcome of ['cancel', 'failure'] as const) {
  test(`native summary ${outcome} preserves history and allows the adjacent prompt`, async () => {
    const { fixture, completion } = await import('./managed-fallback.fixture.ts');
    let summarizing = false;
    await fixture(async f => {
      applyCompactionDefaults(f.session.settingsManager, 1000000);
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
      f.events.length = 0;
      await f.session.prompt('Continue after the interrupted summary');
      await f.session.waitForIdle();
      expect(f.session.getLastAssistantText()).toBe('OK');
      expect(f.events.filter(type => type === 'agent_settled')).toHaveLength(1);
    }, model => summarizing ? Response.json({ error: { message: 'summary rejected' } }, { status: 400 }) : completion(model));
  });
}

test('native model selection recomputes defaults without changing explicit settings', async () => {
  const { fixture, completion } = await import('./managed-fallback.fixture.ts');
  const { createBudgetHooks } = await import('./runtime-budgets.ts');
  let active: import('@earendil-works/pi-coding-agent').AgentSession | null = null;
  await fixture(async f => {
    active = f.session;
    applyCompactionDefaults(f.session.settingsManager, f.session.model?.contextWindow);
    expect(f.session.settingsManager.getCompactionReserveTokens()).toBe(200000);
    await f.session.setModel(f.session.modelRuntime.getModel('fixture', 'deepseek-v4-pro')!);
    expect(f.session.settingsManager.getCompactionReserveTokens()).toBe(52429);
    f.session.settingsManager.setCompactionEnabled(false);
    await f.session.reload();
    await f.session.prompt('After reload');
    expect(f.session.settingsManager.getCompactionEnabled()).toBe(false);
    expect(f.session.settingsManager.getCompactionReserveTokens()).toBe(52429);
  }, completion, createBudgetHooks(() => active), { candidateContext: 262144 });
});
