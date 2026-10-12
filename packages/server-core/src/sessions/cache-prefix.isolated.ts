// input: Isolated Host SessionManager, native Pi resources, and loopback provider/MCP servers
// output: Byte-level cross-turn evidence with reasoning, tool loops, reload and cancellation
// pos: Diagnostic integration at the real Host-to-provider boundary; no paid calls
import { afterAll, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dir, '../../../..');
function difference(left: string, right: string) {
  const a = Buffer.from(left), b = Buffer.from(right);
  let offset = 0;
  while (offset < Math.min(a.length, b.length) && a[offset] === b[offset]) offset++;
  return { offset, ratio: offset / a.length, leftBytes: a.length, rightBytes: b.length,
    before: a.subarray(Math.max(0, offset - 60), offset + 180).toString(),
    after: b.subarray(Math.max(0, offset - 60), offset + 180).toString() };
}

// Module-level isolation is intentional: config paths are captured on first import.
const root = await mkdtemp(join(tmpdir(), 'storyflow-cache-'));
const previousEnv = { HOME: process.env.HOME, CRAFT_CONFIG_DIR: process.env.CRAFT_CONFIG_DIR,
  PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
process.env.HOME = root;
process.env.CRAFT_CONFIG_DIR = join(root, '.craft-agent');
process.env.PI_CODING_AGENT_DIR = join(root, 'agent');
afterAll(async () => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await rm(root, { recursive: true, force: true });
});
const { SessionManager, setSessionPlatform } = await import('./SessionManager.ts');
const { createHeadlessPlatform } = await import('../runtime/platform-headless.ts');
const { getCredentialManager } = await import('../../../shared/src/credentials/manager.ts');
const { getSourceGrantRef } = await import('../../../shared/src/sources/grants.ts');
const { loadSource } = await import('../../../shared/src/sources/storage.ts');
const { getSessionPath } = await import('../../../shared/src/sessions/storage.ts');
const { setupI18n } = await import('../../../shared/src/i18n/setupI18n.ts');

test('real Host preserves early system/tools and reasoning across tool loops, reload and abort', async () => {
  const configDir = process.env.CRAFT_CONFIG_DIR!;
  const agentDir = process.env.PI_CODING_AGENT_DIR!;
  const project = join(root, 'project');
  await mkdir(project, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await mkdir(configDir, { recursive: true });
  await cp(join(repo, 'apps/electron/resources/config-defaults.json'), join(configDir, 'config-defaults.json'));
  if (process.env.PERF_CACHE_SKILLS) {
    await cp(process.env.PERF_CACHE_SKILLS, join(configDir, 'skills'), { recursive: true, dereference: true });
  } else {
    await mkdir(join(configDir, 'skills', 'fixture'), { recursive: true });
    await writeFile(join(configDir, 'skills', 'fixture', 'SKILL.md'), '---\nname: fixture\ndescription: Preserve the original manuscript.\n---\nRead before editing.\n');
  }
  await writeFile(join(project, 'AGENTS.md'), 'Preserve manuscript text exactly.');
  await mkdir(join(project, '.pi'), { recursive: true });
  await writeFile(join(project, '.pi', 'SYSTEM.md'), 'Project system resource: cite inspected files.');
  await writeFile(join(agentDir, 'SYSTEM.md'), 'Global system resource: keep evidence precise.');
  const sourceFolder = join(project, '.craft-agent', 'sources', 'fixture');
  await mkdir(sourceFolder, { recursive: true });
  const mcpScript = join(root, 'mcp.ts');
  await writeFile(mcpScript, `
    import { McpServer } from ${JSON.stringify(join(repo, 'node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js'))};
    import { StdioServerTransport } from ${JSON.stringify(join(repo, 'node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js'))};
    const server = new McpServer({ name: 'fixture', version: '1' });
    server.tool('lookup', 'Read fixture manuscript metadata', {}, async () => ({ content: [{ type: 'text', text: 'SOURCE_RESULT ' + 'unchanged manuscript '.repeat(1000) }] }));
    await server.connect(new StdioServerTransport());
  `);
  const sourceConfig = { id: 'fixture', slug: 'fixture', name: 'Fixture', provider: 'fixture', type: 'mcp', enabled: true,
    connectionStatus: 'connected', createdAt: 1, updatedAt: 1,
    mcp: { transport: 'stdio', command: process.execPath, args: [mcpScript] } };
  await writeFile(join(sourceFolder, 'config.json'), JSON.stringify(sourceConfig));
  const captures: string[] = [];
  const events: unknown[] = [];
  const logs: string[] = [];
  let phase = 'seed';
  let call = 0;
  let abortCaptured!: () => void;
  const heldRequest = new Promise<void>(resolve => { abortCaptured = resolve; });
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const raw = await request.text();
    captures.push(raw);
    call++;
    const model = JSON.parse(raw).model;
    const chunk = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: `call-${call}`, object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    if (phase === 'abort' && call === 2) {
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(chunk({ role: 'assistant', content: 'Partial answer' })));
        abortCaptured();
      } }), { headers: { 'content-type': 'text/event-stream' } });
    }
    const tool = phase !== 'seed' && !phase.startsWith('policy-') && call === 1;
    return new Response(chunk({ role: 'assistant', reasoning_content: `REASONING_${phase}_${call}` }) +
      (tool ? chunk({ tool_calls: [{ index: 0, id: `tool_${phase}`, type: 'function', function: { name: 'mcp__fixture__lookup', arguments: '{}' } }] }) : chunk({ content: `ANSWER_${phase}` })) +
      chunk({}, tool ? 'tool_calls' : 'stop') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  } });
  // Pi detects DeepSeek compatibility from this path; all requests still hit loopback.
  const runtime = { baseUrl: `http://127.0.0.1:${server.port}/deepseek.com/v1`,
    customEndpoint: { api: 'openai-completions' as const },
    customModels: [{ id: 'deepseek-v4-flash', supportsThinking: true, contextWindow: 1_000_000 }] };
  const shimDir = join(root, 'packages/pi-agent-server/dist');
  await mkdir(shimDir, { recursive: true });
  await symlink(join(repo, 'packages/pi-agent-server/src/index.ts'), join(shimDir, 'index.js'));
  const platform = createHeadlessPlatform();
  platform.appRootPath = root;
  const log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
  platform.logger = { info: log, warn: log, error: log, debug: log };
  setSessionPlatform(platform);
  const manager = new SessionManager();
  let sessionId = '';
  manager.setEventSink((_channel, _target, event) => {
    events.push(event);
    if (event.type === 'permission_request') manager.respondToPermission(sessionId, event.request.requestId, true, false);
  });
  const run = async (name: string) => {
    phase = name; call = 0;
    const start = captures.length;
    await manager.sendMessage(sessionId, name === 'seed' ? 'hi' : `USER_${name}`);
    expect(captures.length, JSON.stringify(events) + logs.join('\n')).toBeGreaterThan(start);
    return { name, start, end: captures.length - 1 };
  };
  try {
    const source = loadSource(project, 'fixture');
    expect(source).not.toBeNull();
    await writeFile(join(project, '.craft-agent/config.json'), JSON.stringify({ id: 'directory', name: 'Fixture', slug: 'fixture', createdAt: 1, updatedAt: 1 }));
    await writeFile(join(configDir, 'config.json'), JSON.stringify({
      workspaces: [{ id: 'fixture', name: 'Fixture', rootPath: project, createdAt: 1, directoryConfigId: 'directory', localMcpEnabled: true, defaultEnabledSourceRefs: [getSourceGrantRef(source!)] }],
      activeWorkspaceId: 'fixture', defaultLlmConnection: 'loopback',
      llmConnections: [{ slug: 'loopback', name: 'Loopback', providerType: 'pi_compat', authType: 'api_key', piAuthProvider: 'openai', baseUrl: runtime.baseUrl, customEndpoint: runtime.customEndpoint, models: runtime.customModels, defaultModel: 'deepseek-v4-flash', createdAt: 1 }],
    }));
    await getCredentialManager().setLlmApiKey('loopback', 'loopback-only');
    const session = await manager.createSession('fixture', { permissionMode: 'ask', thinkingLevel: 'high', llmConnection: 'loopback', model: 'deepseek-v4-flash' });
    sessionId = session.id;
    const seed = await run('seed');
    const first = await run('first');
    await manager.refreshConnectionRuntime('loopback');
    const second = await run('second');
    const abortedRun = run('abort');
    await Promise.race([heldRequest, abortedRun.then(() => { throw new Error('Abort fixture settled before its held request'); })]);
    await manager.cancelProcessing(sessionId);
    const aborted = await abortedRun;
    const resumed = await run('resumed');
    const following = await run('following');
    const bodies = captures.map(raw => JSON.parse(raw));
    const transitions = [[first.end, second.start], [second.end, aborted.start], [aborted.end, resumed.start], [resumed.end, following.start]].map(([from, to]) => ({
      from, to, raw: difference(captures[from!]!, captures[to!]!),
      system: difference(JSON.stringify(bodies[from!].messages[0]), JSON.stringify(bodies[to!].messages[0])),
      tools: difference(JSON.stringify(bodies[from!].tools), JSON.stringify(bodies[to!].tools)),
    }));
    const output = process.env.PERF_CACHE_EVIDENCE_DIR;
    if (output) {
      await mkdir(output, { recursive: true });
      for (let index = 0; index < captures.length; index++) await writeFile(join(output, `request-${index}.json`), captures[index]!);
      await writeFile(join(output, 'analysis.json'), JSON.stringify({ seed, first, second, aborted, resumed, following, transitions, events }, null, 2));
      await writeFile(join(output, 'runtime.log'), logs.join('\n'));
    }
    expect(events.filter((event: any) => ['error', 'typed_error'].includes(event.type))).toEqual([]);
    expect(bodies[0].messages[0].content).toContain('Preserve manuscript text exactly.');
    expect(bodies[0].messages[0].content).toContain('Global system resource: keep evidence precise.');
    expect(bodies[0].messages[0].content).toContain('<available_skills>');
    expect(bodies[0].messages[0].content).toContain('permissionMode: ask');
    for (const body of bodies) {
      expect(body.thinking).toEqual({ type: 'enabled' });
      expect(body.messages[0]).toEqual(bodies[0].messages[0]);
      expect(body.tools).toEqual(bodies[0].tools);
    }
    expect(captures[resumed.start]).toContain('<previous_response_interrupted>true</previous_response_interrupted>');
    expect(captures[following.start]).not.toContain('<previous_response_interrupted>true</previous_response_interrupted>');
    for (const { from, to } of transitions) {
      const historical = (body: any) => body.messages.map((message: any) => message.role === 'user' && Array.isArray(message.content)
        ? { ...message, content: message.content.filter((block: any) => !block.text?.startsWith('<storyflow_turn_context>')) }
        : message);
      const previous = JSON.stringify(historical(bodies[from!]));
      expect(JSON.stringify(historical(bodies[to!])).startsWith(previous.slice(0, -1))).toBe(true);
    }
    expect(captures[first.end]).toContain('REASONING_first_1');
    expect(captures[second.start]).toContain('REASONING_first_1');
    expect(captures[second.start]).toContain('SOURCE_RESULT');
    for (const turn of [first, second, aborted, resumed]) expect(turn.end - turn.start).toBe(1);
    await manager.setSessionPermissionMode(sessionId, 'safe');
    const permission = await run('policy-permission');
    expect(JSON.parse(captures[permission.start]!).messages[0].content).toContain('permissionMode: explore');
    await writeFile(join(sourceFolder, 'guide.md'), '# Fixture\nRead the manuscript metadata.');
    const sourcePolicy = await run('policy-source');
    expect(JSON.parse(captures[sourcePolicy.start]!).messages[0].content).toContain('<source_policy>');
    await setupI18n().changeLanguage('zh-Hans');
    const language = await run('policy-language');
    expect(JSON.parse(captures[language.start]!).messages[0].content).toContain('默认使用简体中文回答');
    if (output) for (const turn of [permission, sourcePolicy, language]) {
      await writeFile(join(output, `${turn.name}.json`), captures[turn.start]!);
    }
    const sessionDir = join(getSessionPath(project, sessionId), '.pi-sessions');
    expect(await readFile(join(getSessionPath(project, sessionId), 'session.jsonl'), 'utf8'))
      .not.toContain('<previous_response_interrupted>');
    for (const file of await readdir(sessionDir)) if (file.endsWith('.jsonl')) {
      const history = await readFile(join(sessionDir, file), 'utf8');
      expect(history).not.toContain('<storyflow_turn_context>');
      expect(history).not.toContain('<previous_response_interrupted>');
    }
  } finally {
    try {
      if (sessionId) await manager.cancelProcessing(sessionId);
      await manager.shutdown();
    } finally { server.stop(true); }
  }
}, 120_000);
