// input: PiAgent with controllable subprocess fixtures and injectable ready / abort-settle deadlines
// output: Regression coverage for startup timeout, failure, cancellation, abort settlement, and generation isolation
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

const emitSettled = `process.stdout.write(JSON.stringify({ type: 'event', event: { type: 'agent_settled' } }) + '\\n');`;

// Reports ready, then runs `onMessage` for each inbound command and `onSigterm` when asked to stop.
function turnServer(onSigterm: string, onMessage: string): string {
  return `
process.on('SIGTERM', () => { ${onSigterm} });
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
    ${onMessage}
  }
});
setInterval(() => {}, 1000);
`;
}
const settlingServer = turnServer('process.exit(0);', `if (msg.type === 'prompt') { ${emitSettled} }`);

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

/** Starts a chat and resolves once its prompt has reached the child. */
async function startChat(agent: PiAgent, message: string) {
  const send = (agent as any).send.bind(agent);
  let promptSent!: () => void;
  const sent = new Promise<void>(resolve => { promptSent = resolve; });
  (agent as any).send = (cmd: { type: string }) => {
    const delivered = send(cmd);
    if (cmd.type === 'prompt') promptSent();
    return delivered;
  };
  const finished = (async () => {
    const events: Array<{ type: string }> = [];
    for await (const event of agent.chat(message)) events.push(event);
    return events;
  })();
  await sent;
  return { finished, pid: (agent as any).subprocess.pid as number };
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitUntilDead(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (isAlive(pid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  return !isAlive(pid);
}

describe('Pi abort settlement deadline', () => {
  const deadlines = { abortSettleTimeoutMs: 100, abortStopGraceMs: 300 };
  const complete = expect.objectContaining({ type: 'complete' });
  const exited = expect.objectContaining({ type: 'error', message: expect.stringMatching(/exited/i) });

  it.each(['abort', 'forceAbort'] as const)('stops a child that never settles after %s and serves the next prompt', async (method) => {
    const server = join(fixtureDir, `never-settles-${method}.js`);
    writeFileSync(server, turnServer('process.exit(0);', ''));
    const agent = new PiAgent(createConfig(server), deadlines);
    try {
      const stuck = await startChat(agent, 'cancel me');
      if (method === 'abort') await agent.abort();
      else agent.forceAbort(AbortReason.UserStop);
      expect(await within(stuck.finished, 3_000)).toContainEqual(exited);
      // The turn closes from the child's exit, so no process is left on the session.
      expect(isAlive(stuck.pid)).toBe(false);
      expect(agent.isIdle()).toBe(true);

      writeFileSync(server, settlingServer);
      const next = await startChat(agent, 'next');
      expect(next.pid).not.toBe(stuck.pid);
      expect(await within(next.finished, 3_000)).toContainEqual(complete);
    } finally { agent.destroy(); }
  });

  it('kills a child that also ignores shutdown', async () => {
    const server = join(fixtureDir, 'ignores-abort-and-shutdown.js');
    writeFileSync(server, turnServer('', ''));
    const agent = new PiAgent(createConfig(server), deadlines);
    try {
      const stuck = await startChat(agent, 'cancel me');
      agent.forceAbort(AbortReason.UserStop);
      expect(await within(stuck.finished, 3_000)).toContainEqual(exited);
      expect(agent.isIdle()).toBe(true);
      expect(await waitUntilDead(stuck.pid, 2_000)).toBe(true);

      writeFileSync(server, settlingServer);
      const next = await startChat(agent, 'next');
      expect(await within(next.finished, 3_000)).toContainEqual(complete);
    } finally { agent.destroy(); }
  });

  it('ignores a settlement emitted while the child is being stopped', async () => {
    // Settles only once told to stop, then lingers: closing the turn on that
    // settlement would hand the next prompt to a process about to exit.
    const server = join(fixtureDir, 'settles-while-stopping.js');
    writeFileSync(server, turnServer(`${emitSettled} setTimeout(() => process.exit(0), 150);`, ''));
    const agent = new PiAgent(createConfig(server), { abortSettleTimeoutMs: 100, abortStopGraceMs: 2_000 });
    try {
      const stuck = await startChat(agent, 'cancel me');
      agent.forceAbort(AbortReason.UserStop);
      const events = await within(stuck.finished, 5_000);
      expect(events).toContainEqual(exited);
      expect(events).not.toContainEqual(complete);
      expect(isAlive(stuck.pid)).toBe(false);

      writeFileSync(server, settlingServer);
      const next = await startChat(agent, 'next');
      expect(next.pid).not.toBe(stuck.pid);
      expect(await within(next.finished, 3_000)).toContainEqual(complete);
    } finally { agent.destroy(); }
  });

  it('leaves a child that settles in time running', async () => {
    const server = join(fixtureDir, 'settles-on-abort.js');
    writeFileSync(server, turnServer('process.exit(0);', `if (msg.type === 'abort') { ${emitSettled} }`));
    const agent = new PiAgent(createConfig(server), { abortSettleTimeoutMs: 500, abortStopGraceMs: 100 });
    try {
      const turn = await startChat(agent, 'cancel me');
      agent.forceAbort(AbortReason.UserStop);
      expect(await within(turn.finished, 3_000)).toContainEqual(complete);
      await new Promise(resolve => setTimeout(resolve, 800));
      expect(isAlive(turn.pid)).toBe(true);
      expect((agent as any).subprocess?.pid).toBe(turn.pid);
    } finally { agent.destroy(); }
  });
});

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
