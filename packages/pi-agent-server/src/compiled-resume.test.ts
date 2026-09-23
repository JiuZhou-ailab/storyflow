// input: Compiled Pi server, isolated persisted history and a loopback Provider
// output: Restart and cancellation evidence across the actual JSONL process boundary
// pos: Release smoke complementing compiled-subagent.test.ts
import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getPiAgentServerCompileArgs } from '../../../scripts/build/pi-agent-server.ts';
import { completion } from './managed-fallback.fixture.ts';

test('compiled server resumes original history and settles a cancelled request without retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-resume-binary-'));
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let cancel: (() => void) | undefined;
  const requests: any[] = [];
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as any;
    requests.push(body);
    if (requests.length === 1) return completion(body.model);
    // Keep a real provider stream open until the Host's explicit abort.
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n'));
      setTimeout(() => cancel?.(), 20);
    } }), { headers: { 'content-type': 'text/event-stream' } });
  } });
  try {
    const binary = process.env.CRAFT_E2E_PI_SERVER_BIN ?? join(root, 'pi-agent-server');
    if (!process.env.CRAFT_E2E_PI_SERVER_BIN) {
      const build = Bun.spawn(getPiAgentServerCompileArgs({ platform: process.platform as 'darwin' | 'linux' | 'win32', arch: process.arch as 'arm64' | 'x64', outputPath: binary }), {
        cwd: resolve(import.meta.dir, '..'), stdout: 'ignore', stderr: 'pipe',
      });
      const error = await new Response(build.stderr).text();
      expect(await build.exited, error).toBe(0);
    }
    const agentDir = join(root, 'agent');
    const sessionPath = join(root, 'session');
    await mkdir(agentDir);
    let firstBytes = '';
    for (const turn of [0, 1]) {
      child = Bun.spawn([binary], { cwd: root,
        env: { ...process.env, PATH: '', CRAFT_CONFIG_DIR: join(root, 'config'), PI_CODING_AGENT_DIR: agentDir },
        stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
      const proc = child;
      const send = (message: object) => { (proc.stdin as any).write(JSON.stringify(message) + '\n'); };
      cancel = () => send({ type: 'abort' });
      const stderr = new Response(proc.stderr).text();
      const events: any[] = [];
      const settled = (async () => {
        let buffer = '';
        for await (const bytes of proc.stdout as ReadableStream<Uint8Array>) {
          buffer += new TextDecoder().decode(bytes);
          let end: number;
          while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
            if (!line.trim()) continue;
            const message = JSON.parse(line); events.push(message);
            if (message.type === 'ready') send({ type: 'prompt', id: `turn-${turn}`, message: turn ? 'Cancel this request' : 'Original user text' });
            if (message.type === 'error') throw new Error(message.message);
            if (message.type === 'event' && message.event.type === 'agent_settled') return;
          }
        }
        throw new Error(`Server exited without settlement: ${await stderr}`);
      })();
      send({ type: 'init', apiKey: 'loopback-only', model: 'fixture', cwd: root, workingDirectory: root,
        workspaceRootPath: root, agentDir, sessionId: 'resume-smoke', sessionPath,
        baseUrl: `http://127.0.0.1:${server.port}/v1`, customEndpoint: { api: 'openai-completions' },
        customModels: [{ id: 'fixture' }], plansFolderPath: join(root, 'plans'),
        piAuth: { provider: 'openai', credential: { type: 'api_key', key: 'loopback-only' } } });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([settled, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Resume smoke timed out')), 15000); })]); }
      finally { clearTimeout(timer); }
      expect(events.filter(message => message.type === 'event' && message.event.type === 'agent_settled')).toHaveLength(1);
      if (turn) expect(events.some(message => message.type === 'event' && message.event.type === 'message_end' && message.event.message.stopReason === 'aborted')).toBe(true);
      send({ type: 'shutdown' });
      expect(await proc.exited, await stderr).toBe(0);
      child = undefined;
      const files = (await readdir(join(sessionPath, '.pi-sessions'))).filter(name => name.endsWith('.jsonl'));
      expect(files).toHaveLength(1);
      const bytes = await readFile(join(sessionPath, '.pi-sessions', files[0]!), 'utf8');
      if (turn) expect(bytes.startsWith(firstBytes)).toBe(true);
      else firstBytes = bytes;
    }
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1].messages)).toContain('Original user text');
    expect(JSON.stringify(requests[1].messages)).toContain('OK');
  } finally { child?.kill(); server.stop(true); await rm(root, { recursive: true, force: true }); }
}, 60000);
