// input: Real Pi queries and a loopback Provider
// output: Output integrity, request budget and cancellation regression coverage
// pos: call_llm public query boundary for spec #43
import { expect, test } from 'bun:test';
import { fixture, protocolCompletion } from './managed-fallback.fixture.ts';
import { queryLlmWithEphemeralPiSession } from './ephemeral-llm-query.ts';

function response(text: string, reason = 'stop', thinkingOnly = false) {
  const chunk = (delta: object, finish_reason: string | null) => ({
    id: 'query', object: 'chat.completion.chunk', created: 1, model: 'deepseek-v4-flash',
    choices: [{ index: 0, delta, finish_reason }],
    usage: { prompt_tokens: 12, completion_tokens: reason === 'length' ? 8192 : 5, total_tokens: reason === 'length' ? 8204 : 17 },
  });
  return new Response([chunk({ role: 'assistant', ...(thinkingOnly ? { reasoning_content: 'Only reasoning, no final answer' } : { content: text }) }, null), chunk({}, reason)]
    .map(x => `data: ${JSON.stringify(x)}\n\n`).join('') + 'data: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } });
}

function context(f: Parameters<Parameters<typeof fixture>[0]>[0]) {
  return { config: { ...f.config, miniModel: 'deepseek-v4-flash', thinkingLevel: 'max',
    piAuth: { provider: 'fixture' } } as never,
    cwd: f.root, modelRuntime: f.session.modelRuntime, preferCustomEndpoint: false, debug() {},
  };
}

test('implicit model fallback shares one query deadline and disposes the timed-out attempt', async () => {
  await fixture(async f => {
    const activeSessions = new Set<import('@earendil-works/pi-coding-agent').AgentSession>();
    const queryContext = context(f);
    queryContext.config = { ...f.config, miniModel: 'deepseek-v4-flash', piAuth: { provider: 'fixture' }, managedConnection: undefined } as never;
    const result = await queryLlmWithEphemeralPiSession({ prompt: 'One operation', timeoutMs: 1000 }, { ...queryContext, activeSessions });
    expect(f.requests.map(request => request.model)).toEqual(['deepseek-v4-flash', 'gpt-5-mini']);
    expect(result).toMatchObject({ status: 'cancelled', stopReason: 'aborted', timeoutMs: 1000 });
    expect(activeSessions.size).toBe(0);
  }, async model => {
    await Bun.sleep(600);
    return model === 'deepseek-v4-flash'
      ? Response.json({ error: { message: 'model_not_found' } }, { status: 404 })
      : response('Too late');
  }, undefined, { custom: true, models: ['deepseek-v4-flash', 'gpt-5-mini'] });
});

test('a length-limited query returns incomplete, preserving partial text and actual model', async () => {
  await fixture(async f => {
    const result = await queryLlmWithEphemeralPiSession({ prompt: 'Write an episode.' }, context(f));
    expect(result).toMatchObject({ status: 'incomplete', stopReason: 'length', text: 'Partial episode', model: 'deepseek-v4-flash' });
    expect(f.requests).toHaveLength(1);
  }, () => response('Partial episode', 'length'));
});

test('query defaults do not inherit parent max thinking and ordinary budget reaches provider', async () => {
  await fixture(async f => {
    const result = await queryLlmWithEphemeralPiSession({ prompt: 'Say OK' }, context(f));
    expect(result).toMatchObject({ status: 'completed', maxTokens: 8192, requestedThinkingLevel: 'medium', timeoutMs: 120000 });
    expect(f.requests[0]!.body.max_tokens ?? f.requests[0]!.body.max_completion_tokens).toBe(8192);
    expect(f.requests[0]!.body.reasoning_effort).toBe('medium');
  }, () => response('OK'), undefined, { catalog: [{ id: 'deepseek-v4-flash', name: 'Fixture', supportsThinking: true } as never] });
});

test('small-budget thinking diagnostics identify the request preference, not an effective provider setting', async () => {
  await fixture(async f => {
    const result = await queryLlmWithEphemeralPiSession({ prompt: 'Reply OK', model: 'claude-haiku-4-5', maxTokens: 1536 }, context(f));
    expect(result).toMatchObject({ status: 'completed', requestedThinkingLevel: 'medium' });
    expect(result).not.toHaveProperty('thinkingLevel');
    expect(f.requests[0]!.body.thinking).toEqual({ type: 'disabled' });
    expect(f.requests[0]!.body.max_tokens).toBe(1536);
  }, model => protocolCompletion('anthropic-messages', model), undefined, {
    api: 'anthropic-messages', models: ['claude-haiku-4-5'],
    catalog: [{ id: 'claude-haiku-4-5', name: 'Claude', supportsThinking: true } as never],
  });
});

for (const text of ['not JSON', '{"count":"2"}', '{}']) {
  test(`schema validation rejects without replay: ${text}`, async () => {
    await fixture(async f => {
      const result = await queryLlmWithEphemeralPiSession({ prompt: 'JSON', outputSchema: {
        type: 'object', properties: { count: { type: 'number' } }, required: ['count'],
      } }, context(f));
      expect(result.status).toBe('failed');
      expect(result.warning).toContain('schema');
      expect(f.requests).toHaveLength(1);
    }, () => response(text));
  });
}

test('explicit long budget is capped by trusted capacity, deadline aborts and disposes query', async () => {
  await fixture(async f => {
    const result = await queryLlmWithEphemeralPiSession({ prompt: 'Long', longOutput: true, maxTokens: 32768, thinkingLevel: 'high' }, context(f));
    expect(result).toMatchObject({ maxTokens: 32768, timeoutMs: 300000, requestedThinkingLevel: 'high' });
    expect(f.requests[0]!.body.max_tokens ?? f.requests[0]!.body.max_completion_tokens).toBe(32768);
  }, () => response('Long result'), undefined, { catalog: [{ id: 'deepseek-v4-flash', name: 'Fixture', contextWindow: 1000000, supportsThinking: true,
    fallbackCapabilities: { maxOutputTokens: 32768, tools: true, structuredOutput: 'prompt' } } as never] });
  await fixture(async f => {
    const activeSessions = new Set<any>();
    const result = await queryLlmWithEphemeralPiSession({ prompt: 'Wait', timeoutMs: 30 }, { ...context(f), activeSessions });
    expect(result.status).toBe('cancelled');
    expect(activeSessions.size).toBe(0);
    expect(f.requests).toHaveLength(1);
  }, async () => { await Bun.sleep(100); return response('late'); });
});

test('two episodes have isolated Model Input and independent create-only outputs', async () => {
  const { prepareLlmOutputFile } = await import('../../shared/src/agent/llm-output-file.ts');
  const { readFile, writeFile } = await import('node:fs/promises');
  await fixture(async f => {
    const results = await Promise.all(['episode-one', 'episode-two'].map(async prompt => {
      const output = await prepareLlmOutputFile(`${prompt}.txt`, f.root);
      return output.publish(await queryLlmWithEphemeralPiSession({ prompt }, context(f)));
    }));
    expect(results.every(result => result.status === 'completed')).toBe(true);
    const inputs = f.requests.map(request => JSON.stringify(request.body.messages));
    expect(inputs.filter(input => input.includes('episode-one'))).toHaveLength(1);
    expect(inputs.filter(input => input.includes('episode-two'))).toHaveLength(1);
    const episodes = await Promise.all(['episode-one', 'episode-two'].map(name => readFile(`${f.root}/${name}.txt`, 'utf8')));
    // The coordinator alone publishes continuity, after independently validating both results.
    expect(episodes).toEqual(['episode-one正文', 'episode-two正文']);
    await writeFile(`${f.root}/continuity.json`, JSON.stringify({ episodes }), { flag: 'wx' });
    expect(JSON.parse(await readFile(`${f.root}/continuity.json`, 'utf8')).episodes).toEqual(episodes);
  }, (_model, _index, body) => response(JSON.stringify(body.messages).includes('episode-one') ? 'episode-one正文' : 'episode-two正文'));
});

test('strict validation rejects invalid primitive JSON without coercion', async () => {
  await fixture(async f => {
    const result = await queryLlmWithEphemeralPiSession({ prompt: 'Integer', outputSchema: { type: 'integer', minimum: 5 } }, context(f));
    expect(result.status).toBe('failed');
    expect(f.requests).toHaveLength(1);
  }, () => response('"2"'));
});

test('cancel during query setup and unavailable explicit models make no Provider call', async () => {
  await fixture(async f => {
    let cancelled = false;
    const activeSessions = new Set<any>();
    const pending = queryLlmWithEphemeralPiSession({ prompt: 'cancel setup' }, { ...context(f), activeSessions, isCancelled: () => cancelled });
    cancelled = true;
    expect((await pending).status).toBe('cancelled');
    expect(activeSessions.size).toBe(0);
    await expect(queryLlmWithEphemeralPiSession({ prompt: 'explicit model', model: 'unavailable' }, {
      ...context(f), config: { ...context(f).config as any, managedConnection: undefined },
    })).rejects.toThrow('Requested model is not available');
    expect(f.requests).toHaveLength(0);
  }, () => response('must not run'));
});

test('thinking-only length output cannot complete a query', async () => {
  await fixture(async f => {
    const result = await queryLlmWithEphemeralPiSession({ prompt: 'Write an episode' }, context(f));
    expect(result).toMatchObject({ text: '', status: 'incomplete', stopReason: 'length', outputTokens: 8192 });
  }, () => response('', 'length', true));
});

test('long defaults cannot raise unknown capacity and use 16384 only with a declared ceiling', async () => {
  await fixture(async f => {
    const result = await queryLlmWithEphemeralPiSession({ prompt: 'Long', longOutput: true }, context(f));
    expect(result.maxTokens).toBe(8192);
    expect(f.requests[0]!.body.max_tokens ?? f.requests[0]!.body.max_completion_tokens).toBe(8192);
  }, () => response('OK'), undefined, { unknownCapabilities: true });
  await fixture(async f => {
    const result = await queryLlmWithEphemeralPiSession({ prompt: 'Long', longOutput: true }, context(f));
    expect(result.maxTokens).toBe(16384);
    expect(f.requests[0]!.body.max_tokens ?? f.requests[0]!.body.max_completion_tokens).toBe(16384);
  }, () => response('OK'), undefined, { catalog: [{ id: 'deepseek-v4-flash', name: 'Fixture',
    fallbackCapabilities: { maxOutputTokens: 32768, tools: true, structuredOutput: 'prompt' } } as never] });
});
