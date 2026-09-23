// input: Real Pi sessions, a persisted interrupted turn and a loopback Provider
// output: Resume preserves raw history while Pi owns request projection
// pos: Product session construction acceptance boundary
import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, completion, protocolCompletion } from './managed-fallback.fixture.ts';
import { createPrimaryPiSession } from './primary-session.ts';
import { resolveModelForConnection } from '../../shared/src/agent/backend/connection-runtime.ts';
import { createToolHooks } from './tool-hooks.ts';

test('resuming an interrupted Pi turn preserves its raw history and never executes the partial tool', async () => {
  let encryptedFailure = false;
  await fixture(async f => {
    await f.session.prompt('seed');
    const path = join(f.root, 'product-session');
    const sessionDir = join(path, '.pi-sessions');
    mkdirSync(sessionDir, { recursive: true });
    // Written by unpatched Pi 0.84.4 SessionManager, including completed results and an interrupted tool.
    const file = join(sessionDir, 'legacy.jsonl');
    writeFileSync(file, readFileSync(join(import.meta.dir, 'fixtures/pi-0.84.4-history.jsonl')));
    const assistant = f.session.messages.find(message => message.role === 'assistant')!;
    if (assistant.role !== 'assistant') throw new Error('Missing fixture response');
    const original = readFileSync(file, 'utf8');
    const config = { ...f.config, sessionPath: path, workspaceRootPath: f.root, sessionId: 'resume', model: assistant.model, piAuth: { provider: 'fixture' } };
    let toolExecutions = 0;
    const agentDir = join(f.root, 'agent');
    mkdirSync(agentDir, { recursive: true });
    const settings = JSON.stringify({ cacheWarming: 'idle' });
    writeFileSync(join(agentDir, 'settings.json'), settings);
    const open = () => createPrimaryPiSession({
      config, getConfig: () => config, cwd: f.root, agentDir: join(f.root, 'agent'),
      modelRuntime: f.session.modelRuntime, activeSubagentSessions: new Set(), buildProxyTools: () => [],
      createSessionToolHooks: () => createToolHooks({ beforeToolCall: async event => { toolExecutions++; return event.input; }, afterToolCall: async () => {} }),
      getCurrentUserMessage: () => 'continue', requestHostTool: async () => { throw new Error('Unexpected Host call'); },
      executeSessionRewind: async () => { throw new Error('Unexpected rewind'); },
      handleShutdown() {}, send() {}, debug() {},
    });
    const { session } = await open();
    expect(session.sessionManager.getCwd()).toBe(f.root);
    try {
      expect(readFileSync(file, 'utf8').startsWith(original)).toBe(true);
      session.model!.promptCache = { short: 10.05 };
      session.model!.cost = { input: 100, output: 0, cacheRead: 0, cacheWrite: 0 };
      await session.prompt('Continue without repeating interrupted work.');
      await session.waitForIdle();
      expect(session.getLastAssistantText()).toBe('OK');
      expect(await session.extensionRunner.emitCacheWarmingDecision({ type: 'cache_warming_decision', action: 'warm', warmCost: 0.01, missCost: 1, continuationProbability: 1 })).toBe('stop');
      const requestCount = f.requests.length;
      await Bun.sleep(120);
      expect(f.requests.length).toBe(requestCount);
      expect(readFileSync(join(agentDir, 'settings.json'), 'utf8')).toBe(settings);
      expect(session.cacheWarmingStatus).toMatchObject({ state: 'inactive', reason: 'stopped by extension' });
      expect(toolExecutions).toBe(0);
      expect(JSON.stringify(f.requests.at(-1)!.body)).toContain('EXACT MANUSCRIPT BYTES');
      expect(readFileSync(file, 'utf8').startsWith(original)).toBe(true);
      expect(JSON.stringify(f.requests.at(-1)!.body)).not.toContain('interrupted-write');
      session.settingsManager.applyOverrides({ retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } });
      encryptedFailure = true;
      const before = f.requests.length;
      await session.prompt('A provider rejection must not trigger a text-induced retry.');
      await session.waitForIdle();
      expect(f.requests.length - before).toBe(1);
      const failure = session.messages.at(-1)!;
      expect(failure.role).toBe('assistant');
      if (failure.role === 'assistant') {
        expect(failure.stopReason).toBe('error');
        expect(failure.errorMessage).toContain('invalid_encrypted_content');
        expect(failure.errorMessage).not.toContain('please retry');
      }
    } finally { await session.abort(); session.dispose(); }
    const originalUser = session.sessionManager.getEntries().find(entry => entry.type === 'message' && entry.message.role === 'user')!;
    session.sessionManager.appendContextEdit(originalUser.id, { content: 'Projected manuscript context' });
    const persisted = readFileSync(file, 'utf8');
    const { session: resumed } = await open();
    expect(resumed.sessionId).toBe(session.sessionId);
    expect(JSON.stringify(resumed.messages)).toContain('Projected manuscript context');
    expect(persisted).toContain('Original manuscript');
    expect(readFileSync(file, 'utf8').startsWith(persisted)).toBe(true);
    encryptedFailure = false;
    resumed.sessionManager.appendMessage({ role: 'toolResult', toolCallId: 'orphan-read', toolName: 'read', content: [{ type: 'text', text: 'ORPHAN RESULT' }], isError: false, timestamp: 10 });
    resumed.refreshContext();
    const withOrphan = readFileSync(file, 'utf8');
    const beforeOrphan = f.requests.length;
    await resumed.prompt('Continue with orphan history');
    await resumed.waitForIdle();
    expect(f.requests.length - beforeOrphan).toBe(1);
    expect(resumed.messages.at(-1)).toMatchObject({ stopReason: 'error', errorMessage: expect.stringContaining('orphan tool result') });
    expect(readFileSync(file, 'utf8').startsWith(withOrphan)).toBe(true);
    expect(toolExecutions).toBe(0);
    resumed.dispose();
    writeFileSync(file, '{broken history');
    await expect(open()).rejects.toThrow('not a valid');
    expect(readFileSync(file, 'utf8')).toBe('{broken history');
    writeFileSync(file, '');
    await expect(open()).rejects.toThrow('empty history');
    expect(readFileSync(file, 'utf8')).toBe('');
  }, async (model, _index, body) => JSON.stringify(body.messages).includes('ORPHAN RESULT') ? Response.json({ error: { message: 'orphan tool result' } }, { status: 400 }) : encryptedFailure ? Response.json({ error: { message: 'invalid_encrypted_content' } }, { status: 400 }) : new Response(
    (await completion(model).text()).replace('data: [DONE]', 'data: {"choices":[],"usage":{"prompt_tokens":100000,"completion_tokens":1,"total_tokens":100001}}\n\ndata: [DONE]'),
    { headers: { 'content-type': 'text/event-stream' } },
  ));
});

test('an upgraded managed Gemini conversation requests only its authorized replacement and retains history', async () => {
  await fixture(async f => {
    const sessionPath = join(f.root, 'legacy-managed'), sessionDir = join(sessionPath, '.pi-sessions');
    mkdirSync(sessionDir, { recursive: true });
    const file = join(sessionDir, 'legacy.jsonl');
    const original = readFileSync(join(import.meta.dir, 'fixtures/pi-0.84.4-history.jsonl'), 'utf8');
    writeFileSync(file, original);
    const model = resolveModelForConnection('gemini-3.5-flash', {
      slug: 'storyflow-managed-gemini', name: 'Gemini', providerType: 'pi_compat', authType: 'api_key_with_endpoint',
      models: ['gemini-3.8-flash'], createdAt: 1,
    });
    const config = { ...f.config, sessionPath, workspaceRootPath: f.root, sessionId: 'legacy-managed', model, piAuth: { provider: 'fixture' } };
    const { session } = await createPrimaryPiSession({
      config, getConfig: () => config, cwd: f.root, agentDir: join(f.root, 'agent'), modelRuntime: f.session.modelRuntime,
      activeSubagentSessions: new Set(), buildProxyTools: () => [], createSessionToolHooks: () => createToolHooks({ beforeToolCall: async event => event.input, afterToolCall: async () => {} }),
      getCurrentUserMessage: () => 'continue', requestHostTool: async () => { throw new Error('Unexpected tool'); },
      executeSessionRewind: async () => { throw new Error('Unexpected rewind'); }, handleShutdown() {}, send() {}, debug() {},
    });
    try {
      await session.prompt('Continue the existing manuscript'); await session.waitForIdle();
      expect(session.getLastAssistantText()).toBe('OK');
      expect(f.requests.length).toBeGreaterThan(0);
      expect(f.requests.every(request => request.model === 'gemini-3.8-flash')).toBe(true);
      expect(readFileSync(file, 'utf8').startsWith(original)).toBe(true);
    } finally { await session.abort(); session.dispose(); }
  }, model => protocolCompletion('google-generative-ai', model), undefined,
  { api: 'google-generative-ai', models: ['gemini-3.8-flash'] });
});
