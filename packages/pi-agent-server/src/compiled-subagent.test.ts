// input: Canonical compiled server, clean cwd, conflicting global Extension and loopback Provider
// output: Proof that parent/child requests use model capacity and embedded subagents execute tools without a Pi CLI
// pos: Release smoke for the Storyflow subprocess boundary
import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getPiAgentServerCompileArgs } from '../../../scripts/build/pi-agent-server.ts';

test.each(['stop', 'length'])('compiled server executes its own subagent with global name collision and no CLI (%s)', async childStopReason => {
  const root = await mkdtemp(join(tmpdir(), 'storyflow-binary-'));
  const requests: any[] = [];
  const maxOutputTokens = 32768;
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let stderr = '';
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as any;
    requests.push(body);
    const names = body.tools?.map((tool: any) => tool.function.name) ?? [];
    const delegated = !names.includes('subagent');
    const hasResult = body.messages.some((message: any) => message.role === 'tool');
    const call = delegated ? { name: 'read', arguments: { path: join(root, 'source.txt') } }
      : { name: 'subagent', arguments: { task: 'Read source.txt and return the exact text.', capability: 'read_only' } };
    const delta = hasResult ? { content: 'SMOKE COMPLETE' } : { tool_calls: [{ index: 0, id: delegated ? 'read-1' : 'delegate-1', type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] };
    const chunks = [{ choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: hasResult ? (delegated ? childStopReason : 'stop') : 'tool_calls' }],
        usage: { prompt_tokens: 10, completion_tokens: childStopReason === 'length' && delegated ? maxOutputTokens : 1,
          total_tokens: 10 + (childStopReason === 'length' && delegated ? maxOutputTokens : 1) } }];
    return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  } });
  try {
    const binary = process.env.CRAFT_E2E_PI_SERVER_BIN ?? join(root, 'pi-agent-server');
    if (!process.env.CRAFT_E2E_PI_SERVER_BIN) {
      const build = Bun.spawn(getPiAgentServerCompileArgs({ platform: process.platform as 'darwin' | 'linux' | 'win32', arch: process.arch as 'arm64' | 'x64', outputPath: binary }), {
        cwd: resolve(import.meta.dir, '..'), stdout: 'pipe', stderr: 'pipe',
      });
      const buildError = new Response(build.stderr).text();
      await new Response(build.stdout).text();
      expect(await build.exited, await buildError).toBe(0);
    }
    const agentDir = join(root, 'agent');
    await mkdir(join(agentDir, 'extensions'), { recursive: true });
    await writeFile(join(root, 'source.txt'), 'EXACT SOURCE BYTES');
    await writeFile(join(agentDir, 'extensions', 'collision.ts'), `export default function(pi) {
      for (const name of ['subagent','non_conflicting']) pi.registerTool({ name, label:name, description:name,
        parameters:{type:'object',properties:{agent:{type:'string'}},required:['agent']},
        execute:async()=>{throw new Error('WRONG GLOBAL TOOL')} });
    }`);
    const events: any[] = [];
    child = Bun.spawn([binary], { cwd: root,
      env: { ...process.env, PATH: '', CRAFT_CONFIG_DIR: join(root, 'config'), PI_CODING_AGENT_DIR: agentDir },
      stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    const proc = child;
    const send = (message: object) => { (proc.stdin as any).write(JSON.stringify(message) + '\n'); };
    const stderrRead = new Response(proc.stderr).text().then(text => { stderr = text; });
    const read = (async () => {
      let buffer = '';
      for await (const bytes of proc.stdout as ReadableStream<Uint8Array>) {
        buffer += new TextDecoder().decode(bytes);
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line); events.push(event);
          if (event.type === 'ready') send({ type: 'prompt', id: 'smoke', message: 'Delegate reading source.txt to a read-only subagent.' });
          if (event.type === 'pre_tool_use_request') send({ type: 'pre_tool_use_response', requestId: event.requestId, action: 'allow' });
          if (event.type === 'error') throw new Error(event.message);
          if (event.type === 'event' && event.event.type === 'agent_settled') return;
        }
      }
      throw new Error(`Server exited without settlement: ${stderr}`);
    })();
    send({ type: 'init', apiKey: 'loopback-only', model: 'fixture', miniModel: 'fixture', cwd: root,
      thinkingLevel: 'medium', workspaceRootPath: root, workingDirectory: root, agentDir,
      sessionId: 'smoke', sessionPath: '', plansFolderPath: join(root, 'plans'),
      baseUrl: `http://127.0.0.1:${server.port}/v1`, customEndpoint: { api: 'openai-completions' },
      customModels: [{ id: 'fixture', contextWindow: 131072,
        fallbackCapabilities: { maxOutputTokens, tools: true, structuredOutput: 'prompt' } }],
      piAuth: { provider: 'openai', credential: { type: 'api_key', key: 'loopback-only' } } });
    let timer: ReturnType<typeof setTimeout>;
    try { await Promise.race([read, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Binary smoke timed out')), 30000); })]); }
    finally { clearTimeout(timer!); }
    const tools = requests[0].tools.map((tool: any) => tool.function);
    expect(tools.find((tool: any) => tool.name === 'subagent').parameters.properties.capability).toBeDefined();
    expect(tools.some((tool: any) => tool.name === 'non_conflicting')).toBe(true);
    expect(requests).toHaveLength(4);
    for (const request of requests) expect(request.max_tokens ?? request.max_completion_tokens).toBe(maxOutputTokens);
    expect(JSON.stringify(requests)).toContain('EXACT SOURCE BYTES');
    expect(events.some(event => event.type === 'event' && event.event.type === 'tool_execution_end' && event.event.toolName === 'subagent' && event.event.isError === (childStopReason === 'length'))).toBe(true);
    child.kill(); await child.exited; await stderrRead;
    expect(stderr).not.toContain('dark.json');
  } finally { child?.kill(); server.stop(true); await rm(root, { recursive: true, force: true }); }
}, 60000);
