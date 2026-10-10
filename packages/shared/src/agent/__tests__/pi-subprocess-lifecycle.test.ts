// input: PiAgent with a real subprocess that dies before reporting ready
// output: Regression coverage for subprocess ready settlement and per-generation exit handling
// pos: Lifecycle contract between the Pi transport and its child process

import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiAgent } from '../pi-agent.ts';
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

function within<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([promise, new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), ms))]);
}

describe('Pi subprocess lifecycle', () => {
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
      expect(outcome).toMatch(/exited/i);
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
