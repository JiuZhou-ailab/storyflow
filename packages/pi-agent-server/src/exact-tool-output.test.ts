import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPiToolRuntime } from './pi-tool-runtime.ts';

test('exact read/generated content stays recoverable and logs remain explicitly summarized', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exact-tool-'));
  let summaries = 0;
  try {
    const runtime = createPiToolRuntime({ getConfig: () => ({ workspaceRootPath: root, sessionId: 'fixture' } as any),
      getProxyToolDefs: () => [], pendingPreToolUse: new Map(), pendingToolExecutions: new Map(), pendingConversationRewinds: new Map(),
      send() {}, debug() {}, async runMiniCompletion() { summaries++; return 'Log summary'; },
      async preExecuteCallLlm() { return { text: '' }; },
    });
    const hooks = new Map<string, any>();
    const extension = runtime.createSessionToolHooks({ getSession: () => null, getUserRequest: () => '', intentByCallId: new Map(), toolResultTokens: 0 });
    await extension.factory({ on: (name: string, handler: any) => hooks.set(name, handler) } as any);
    const exact = '原文对白\n'.repeat(10000);
    for (const toolName of ['read', 'mcp__session__call_llm', 'bash']) {
      hooks.get('turn_start')();
      const result = await hooks.get('tool_result')({ toolName, toolCallId: toolName, input: {}, content: [{ type: 'text', text: exact }], isError: false });
      expect(await readFile(result.details.fullContentPath, 'utf8')).toBe(exact);
      expect(result.details.representation).toBe(toolName === 'bash' ? 'summary' : 'preview');
    }
    expect(summaries).toBe(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('file-output proxy failures propagate as Pi tool failures', async () => {
  const pendingToolExecutions = new Map<string, any>();
  const runtime = createPiToolRuntime({ getConfig: () => null,
    getProxyToolDefs: () => [{ name: 'mcp__session__call_llm', description: 'query', inputSchema: { type: 'object' } } as any],
    pendingPreToolUse: new Map(), pendingToolExecutions, pendingConversationRewinds: new Map(),
    send(message: any) { queueMicrotask(() => pendingToolExecutions.get(message.requestId).resolve({ content: 'incomplete', isError: true })); },
    debug() {}, async runMiniCompletion() { return null; }, async preExecuteCallLlm() { throw new Error('must route to Host'); },
  });
  await expect(runtime.buildProxyTools()[0]!.execute('fixture', { prompt: 'write', outputPath: 'episode.txt' }, undefined, undefined, {} as any)).rejects.toThrow('incomplete');
});
