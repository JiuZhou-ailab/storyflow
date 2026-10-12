// input: Host prompts, the real Pi subprocess, and deterministic loopback SSE
// output: Three-turn and process-resume provider request evidence without paid calls
// pos: Diagnostic integration coverage for the Host-to-Pi prompt boundary
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PromptBuilder } from '../prompt-builder.ts';
import { getSystemPrompt } from '../../../prompts/system.ts';
import { protocolCompletion } from '../../../../../pi-agent-server/src/managed-fallback.fixture.ts';

const repo = resolve(import.meta.dir, '../../../../../..');
const apis = ['openai-completions', 'openai-responses', 'anthropic-messages'] as const;

function commonBytes(left: string, right: string) {
  const a = Buffer.from(left), b = Buffer.from(right);
  let index = 0;
  while (index < Math.min(a.length, b.length) && a[index] === b[index]) index++;
  return index;
}

for (const api of apis) for (const cacheRetention of ['short', 'long'] as const) {
  test(`${api} (${cacheRetention}): captures stable policy and transient data over three turns and a process restart`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'storyflow-prefix-'));
    const captures: string[] = [];
    const projections: ReturnType<PromptBuilder['buildTurnContext']>[] = [];
    let child: ReturnType<typeof Bun.spawn> | undefined;
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
      const raw = await request.text();
      captures.push(raw);
      return protocolCompletion(api, JSON.parse(raw).model);
    } });
    try {
      const agentDir = join(root, 'agent');
      const project = join(root, 'project');
      const sessionPath = join(root, 'session');
      await mkdir(agentDir); await mkdir(project);
      await writeFile(join(project, 'AGENTS.md'), 'Preserve manuscript text exactly.');
      const builder = new PromptBuilder({
        workspace: { id: 'fixture', slug: 'fixture', name: 'Fixture', rootPath: project, createdAt: 1 },
        session: { id: 'prefix', workspaceRootPath: project, workingDirectory: project, createdAt: 1, lastUsedAt: 1 },
      });
      for (const turns of [[0, 1, 2], [3]]) {
        child = Bun.spawn([process.execPath, join(repo, 'packages/pi-agent-server/src/index.ts')], {
          cwd: project,
          env: { ...process.env, HOME: root, CRAFT_CONFIG_DIR: join(root, 'config'), PI_CODING_AGENT_DIR: agentDir, PI_CACHE_RETENTION: cacheRetention },
          stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
        });
        const proc = child;
        const errors = new Response(proc.stderr as ReadableStream<Uint8Array>).text();
        const send = (message: object) => { (proc.stdin as { write(value: string): unknown }).write(JSON.stringify(message) + '\n'); };
        let cursor = 0;
        const prompt = () => {
          const turn = turns[cursor++]!;
          const projection = builder.buildTurnContext({}, { policy: '<source_policy>Read guides before use.</source_policy>', data: '<sources>fixture source</sources>' });
          projections.push(projection);
          send({ type: 'prompt', id: `turn-${turn}`, message: `User turn ${turn}`,
            systemPrompt: getSystemPrompt('', undefined, project, project, 'default', undefined, false, 'en'),
            turnPolicy: projection.system.join('\n\n'), turnContext: projection.data.join('\n\n') });
        };
        const completed = (async () => {
          let buffer = '';
          for await (const bytes of proc.stdout as ReadableStream<Uint8Array>) {
            buffer += new TextDecoder().decode(bytes);
            let end: number;
            while ((end = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
              if (!line.trim()) continue;
              const message = JSON.parse(line);
              if (message.type === 'ready') prompt();
              if (message.type === 'error') throw new Error(message.message);
              if (message.type === 'event' && message.event.type === 'message_end') {
                expect(message.event.message.stopReason).not.toBe('error');
              }
              if (message.type === 'event' && message.event.type === 'agent_settled') {
                if (cursor < turns.length) prompt();
                else { send({ type: 'shutdown' }); return; }
              }
            }
          }
          throw new Error(`No settlement: ${await errors}`);
        })();
        send({ type: 'init', apiKey: 'loopback-only', model: 'fixture', cwd: project, workingDirectory: project,
          workspaceRootPath: project, agentDir, sessionId: 'prefix', sessionPath,
          baseUrl: `http://127.0.0.1:${server.port}/v1`, customEndpoint: { api },
          customModels: [{ id: 'fixture' }], plansFolderPath: join(sessionPath, 'plans'),
          piAuth: { provider: api === 'anthropic-messages' ? 'anthropic' : 'openai', credential: { type: 'api_key', key: 'loopback-only' } } });
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([completed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Prompt capture timed out')), 30000); })]);
          expect(await proc.exited, await errors).toBe(0);
        } finally { clearTimeout(timer); }
        child = undefined;
      }
      expect(captures).toHaveLength(4);
      const bodies = captures.map(raw => JSON.parse(raw));
      const system = (body: any) => JSON.stringify(body.system ?? body.instructions ?? (body.messages ?? body.input).filter((m: any) => ['system', 'developer'].includes(m.role)));
      for (let turn = 0; turn < 4; turn++) {
        expect(system(bodies[turn])).toBe(system(bodies[0]));
        expect(JSON.stringify(bodies[turn].tools)).toBe(JSON.stringify(bodies[0].tools));
        expect(bodies[turn].prompt_cache_key).toBe(bodies[0].prompt_cache_key);
        expect(captures[turn]!.match(/<storyflow_turn_context>/g)).toHaveLength(1);
        for (let previous = 0; previous <= turn; previous++) expect(captures[turn]).toContain(`User turn ${previous}`);
      }
      const files = await readdir(join(sessionPath, '.pi-sessions'));
      expect(files.filter(file => file.endsWith('.jsonl'))).toHaveLength(1);
      const history = await readFile(join(sessionPath, '.pi-sessions', files.find(file => file.endsWith('.jsonl'))!), 'utf8');
      expect(history).not.toContain('<storyflow_turn_context>');
      if (process.env.PERF_MODEL_EVIDENCE_DIR) {
        const output = join(process.env.PERF_MODEL_EVIDENCE_DIR, cacheRetention);
        await mkdir(output, { recursive: true });
        for (let i = 0; i < captures.length; i++) await writeFile(join(output, `${api}-${i + 1}.json`), captures[i]!);
        await writeFile(join(output, `${api}-analysis.json`), JSON.stringify({ api, cacheRetention, projections,
          bytes: captures.map(raw => Buffer.byteLength(raw)),
          stableSystemBytes: Buffer.byteLength(system(bodies[0])),
          toolBytes: Buffer.byteLength(JSON.stringify(bodies[0].tools)),
          transitions: captures.slice(1).map((raw, index) => {
            const offset = commonBytes(captures[index]!, raw);
            return { from: index + 1, to: index + 2, firstDifferentByte: offset,
              before: Buffer.from(captures[index]!).subarray(offset, offset + 160).toString(),
              after: Buffer.from(raw).subarray(offset, offset + 160).toString() };
          }),
        }, null, 2));
      }
    } finally {
      if (child) { child.kill(); await child.exited; }
      server.stop(true); await rm(root, { recursive: true, force: true });
    }
  }, 120000);
}
