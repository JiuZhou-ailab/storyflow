// input: PiAgent with controllable subprocess fixtures and injectable ready deadlines
// output: Regression coverage for startup timeout, failure, cancellation, and generation isolation
// pos: Lifecycle contract between the Pi transport and its child process

import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiAgent } from '../pi-agent.ts';
import { AbortReason } from '../backend/types.ts';
import type { BackendConfig } from '../backend/types.ts';

const fixtureDir = mkdtempSync(join(tmpdir(), 'pi-subprocess-lifecycle-'));
const exitingServer = join(fixtureDir, 'exits-before-ready.js');
writeFileSync(exitingServer, 'process.exit(3);\n');

// Reports ready, answers llm_query after a delay, and exits late on SIGTERM so
// a replaced generation's exit lands while the next generation is in flight.
const slowServer = join(fixtureDir, 'slow-exit-server.js');
writeFileSync(slowServer, `
process.on('SIGTERM', () => setTimeout(() => process.exit(0), 200));
process.stdout.write(JSON.stringify({ type: 'ready' }) + '\\n');
let buffer = '';
process.stdin.on('data', chunk => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.type === 'llm_query') {
      setTimeout(() => process.stdout.write(JSON.stringify({
        type: 'llm_query_result', id: msg.id,
        result: { text: 'ok', status: 'completed', stopReason: 'stop', model: 'test-model' },
      }) + '\\n'), 500);
    }
  }
});
setInterval(() => {}, 1000);
`);

// Never reports ready; exits shortly after SIGTERM so a replaced generation dies mid-wait.
const neverReadyServer = join(fixtureDir, 'never-ready-server.js');
writeFileSync(neverReadyServer, `
process.on('SIGTERM', () => setTimeout(() => process.exit(0), 100));
setInterval(() => {}, 1000);
`);

afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));

function createConfig(piServer: string): BackendConfig {
  return {
    workspace: { id: 'ws-test', name: 'Test', rootPath: fixtureDir } as any,
    session: { id: 'session-test', workspaceRootPath: fixtureDir, createdAt: Date.now(), lastUsedAt: Date.now() } as any,
    isHeadless: true,
    runtime: { paths: { piServer, node: process.execPath } },
  } as BackendConfig;
}

async function within<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<'timeout'>(resolve => {
      timer = setTimeout(() => resolve('timeout'), ms);
    })]);
  } finally { clearTimeout(timer); }
}

describe('Pi subprocess lifecycle', () => {
  it('times out a silent child and starts a fresh child on the next query', async () => {
    const server = join(fixtureDir, 'timeout-then-ready.js');
    writeFileSync(server, `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`);
    const agent = new PiAgent(createConfig(server), { readyTimeoutMs: 200 });
    try {
      const outcome = await within(
        agent.queryLlm({ prompt: 'hi' }).catch(error => error),
        2_000,
      );
      expect(outcome).toMatchObject({ code: 'PI_READY_TIMEOUT', retryable: true });
      writeFileSync(server, readFileSync(slowServer));
      await expect(agent.queryLlm({ prompt: 'retry' })).resolves.toMatchObject({ text: 'ok' });
    } finally { agent.destroy(); }
  });

  it('rejects immediately with the error reported before ready', async () => {
    const server = join(fixtureDir, 'init-error.js');
    writeFileSync(server, `
process.stdout.write(JSON.stringify({ type: 'error', code: 'INIT_FAILED', message: 'Invalid model configuration' }) + '\\n');
setInterval(() => {}, 1000);
`);
    const agent = new PiAgent(createConfig(server), { readyTimeoutMs: 5_000 });
    try {
      const outcome = await within(agent.queryLlm({ prompt: 'hi' }).catch(error => error), 1_000);
      expect(outcome).toMatchObject({ message: 'Invalid model configuration', code: 'INIT_FAILED' });
    } finally { agent.destroy(); }
  });

  it.each(['abort', 'forceAbort'] as const)('cancels the ready wait on %s', async (method) => {
    const agent = new PiAgent(createConfig(neverReadyServer), { readyTimeoutMs: 5_000 });
    try {
      const pending = agent.queryLlm({ prompt: 'hi' }).catch(error => error);
      await new Promise(resolve => setTimeout(resolve, 200));
      if (method === 'abort') await agent.abort();
      else agent.forceAbort(AbortReason.UserStop);
      expect(await within(pending, 500)).toMatchObject({ name: 'AbortError' });
    } finally { agent.destroy(); }
  });

  it('does not spawn when aborted before credential preparation finishes', async () => {
    const config = createConfig(neverReadyServer);
    config.validateWorkingDirectory = () => { throw new Error('Spawn must not be reached after cancellation'); };
    const agent = new PiAgent(config);
    try {
      const pending = agent.queryLlm({ prompt: 'hi' }).catch(error => error);
      await agent.abort();
      expect(await within(pending, 500)).toMatchObject({ name: 'AbortError' });
    } finally { agent.destroy(); }
  });

  it('settles startup on destroy even when the child ignores SIGTERM', async () => {
    const server = join(fixtureDir, 'ignores-shutdown.js');
    writeFileSync(server, `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`);
    const agent = new PiAgent(createConfig(server), { readyTimeoutMs: 5_000 });
    const pending = agent.queryLlm({ prompt: 'hi' }).catch(error => error);
    await new Promise(resolve => setTimeout(resolve, 200));
    agent.destroy();
    expect(await within(pending, 500)).toMatchObject({ name: 'AbortError' });
  });

  it('fails fast when the subprocess exits before reporting ready', async () => {
    const agent = new PiAgent(createConfig(exitingServer));
    const outcome = await within(
      agent.queryLlm({ prompt: 'hi' }).then(() => 'resolved', (error: Error) => error.message),
      5_000,
    );
    agent.destroy();
    expect(outcome).not.toBe('timeout');
    expect(outcome).toMatch(/exited/i);
  });

  it('fails fast when the subprocess cannot be spawned', async () => {
    const agent = new PiAgent(createConfig(join(fixtureDir, 'missing-binary')));
    const outcome = await within(
      agent.queryLlm({ prompt: 'hi' }).then(() => 'resolved', (error: Error) => error.message),
      5_000,
    );
    agent.destroy();
    expect(outcome).not.toBe('timeout');
    expect(outcome).not.toBe('resolved');
  });

  it('fails the waiter of a generation replaced before it became ready', async () => {
    const agent = new PiAgent(createConfig(neverReadyServer));
    try {
      const pending = agent.queryLlm({ prompt: 'hi' }).then(() => 'resolved', (error: Error) => error.message);
      await new Promise(resolve => setTimeout(resolve, 300));
      await agent.reconnect();
      // Start the next generation before the replaced child exits (~100ms).
      void agent.queryLlm({ prompt: 'next' }).catch(() => {});
      const outcome = await within(pending, 5_000);
      expect(outcome).not.toBe('timeout');
      expect(outcome).toMatch(/aborted/i);
    } finally {
      agent.destroy();
    }
  });

  it('ignores a late exit from a replaced subprocess generation', async () => {
    const agent = new PiAgent(createConfig(slowServer));
    try {
      await expect(agent.queryLlm({ prompt: 'warm up' })).resolves.toMatchObject({ text: 'ok' });
      await agent.reconnect();
      // The old child exits ~200ms after SIGTERM, while this query waits ~500ms.
      await expect(agent.queryLlm({ prompt: 'after restart' })).resolves.toMatchObject({ text: 'ok' });
    } finally {
      agent.destroy();
    }
  });
});
