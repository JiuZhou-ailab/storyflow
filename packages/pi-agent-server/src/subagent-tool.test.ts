// input: A fake Pi session boundary and a read-only delegated task
// output: Contract proof for an ephemeral, capability-limited subagent run
// pos: Public behavior test for Storyflow's built-in Pi subagent Extension

import { describe, expect, test } from 'bun:test';
import { Type } from '@sinclair/typebox';
import type {
  AgentSession,
  CreateAgentSessionOptions,
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';

import { createSubagentExtension } from './subagent-tool.ts';

function registerSubagent(
  extension: ReturnType<typeof createSubagentExtension>,
  captureTurnStart?: (handler: () => void) => void,
): ToolDefinition<any, any> {
  let registered: ToolDefinition<any, any> | undefined;
  extension.factory({
    registerTool(tool) {
      registered = tool;
    },
    on(event, handler) {
      if (event === 'turn_start') captureTurnStart?.(handler as () => void);
    },
  } as ExtensionAPI);
  if (!registered) throw new Error('subagent tool was not registered');
  return registered;
}

describe('createSubagentExtension', () => {
  test('registers as a real Pi Extension tool without a persistent session', async () => {
    const authStorage = AuthStorage.inMemory();
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const extension = createSubagentExtension({
      cwd: process.cwd(),
      agentDir: process.cwd(),
      authStorage,
      modelRegistry,
      toolDefinitions: [],
      createSessionHooks: () => ({
        name: 'test-hooks',
        factory() {},
      }),
    });
    const settingsManager = SettingsManager.inMemory();
    const resourceLoader = new DefaultResourceLoader({
      cwd: process.cwd(),
      agentDir: process.cwd(),
      settingsManager,
      extensionFactories: [extension],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd: process.cwd(),
      authStorage,
      modelRegistry,
      resourceLoader,
      settingsManager,
      sessionManager: SessionManager.inMemory(process.cwd()),
      tools: ['subagent'],
    });

    try {
      expect(session.getActiveToolNames()).toEqual(['subagent']);
      expect(session.sessionManager.isPersisted()).toBe(false);
    } finally {
      session.dispose();
    }
  });

  test('runs a read-only task in an in-memory session and reports usage', async () => {
    const createdOptions: CreateAgentSessionOptions[] = [];
    let disposed = false;
    const fakeSession = {
      async prompt() {},
      async waitForIdle() {},
      async abort() {},
      dispose() {
        disposed = true;
      },
      async setModel() {},
      setThinkingLevel() {},
      getLastAssistantText() {
        return 'Inspected the runtime boundary.';
      },
      getSessionStats() {
        return {
          tokens: {
            input: 120,
            output: 30,
            cacheRead: 10,
            cacheWrite: 5,
            total: 165,
          },
          cost: 0.01,
          assistantMessages: 2,
        };
      },
    } as unknown as AgentSession;

    const extension = createSubagentExtension({
      cwd: '/workspace',
      agentDir: '/agent',
      authStorage: {} as never,
      modelRegistry: {} as never,
      thinkingLevel: 'high',
      toolDefinitions: ['read', 'grep', 'find', 'ls', 'web_search', 'web_fetch', 'edit', 'write', 'bash'].map(
        name => ({
          name,
          label: name,
          description: name,
          parameters: Type.Object({}),
          async execute() {
            return { content: [{ type: 'text', text: 'ok' }] };
          },
        }),
      ),
      createSessionHooks: () => ({
        name: 'test-hooks',
        factory() {},
      }),
      async createSession(options) {
        createdOptions.push(options);
        return fakeSession;
      },
    });
    const tool = registerSubagent(extension);

    const result = await tool.execute(
      'call-1',
      {
        task: 'Inspect the runtime boundary.',
        capability: 'read_only',
      },
      undefined,
      undefined,
      {
        model: { provider: 'test', id: 'model' },
      } as ExtensionContext,
    );

    expect(createdOptions).toHaveLength(1);
    expect(createdOptions[0]?.tools).toEqual([
      'read',
      'grep',
      'find',
      'ls',
      'web_search',
      'web_fetch',
    ]);
    expect(createdOptions[0]?.thinkingLevel).toBe('high');
    expect(createdOptions[0]?.sessionManager?.isPersisted()).toBe(false);
    expect(createdOptions[0]?.settingsManager?.getRetrySettings()).toMatchObject({ maxRetries: 1 });
    expect(createdOptions[0]?.settingsManager?.getProviderRetrySettings()).toMatchObject({ maxRetries: 0 });
    expect(result.details).toMatchObject({
      kind: 'storyflow-subagent',
      result: {
        capability: 'read_only',
        status: 'completed',
        output: 'Inspected the runtime boundary.',
      },
      usage: {
        input: 120,
        output: 30,
        cacheRead: 10,
        cacheWrite: 5,
        cost: 0.01,
        modelCalls: 2,
      },
    });
    expect(disposed).toBe(true);
  });

  test('runs sibling read-only calls as independently visible Pi tools', async () => {
    let sessionIndex = 0;
    const extension = createSubagentExtension({
      cwd: '/workspace',
      agentDir: '/agent',
      authStorage: {} as never,
      modelRegistry: {} as never,
      toolDefinitions: ['read', 'grep', 'find', 'ls'].map(name => ({
        name,
        label: name,
        description: name,
        parameters: Type.Object({}),
        async execute() {
          return { content: [{ type: 'text', text: 'ok' }] };
        },
      })),
      createSessionHooks: () => ({
        name: 'test-hooks',
        factory() {},
      }),
      async createSession() {
        const index = sessionIndex++;
        return {
          async prompt() {},
          async waitForIdle() {},
          async abort() {},
          dispose() {},
          async setModel() {},
          setThinkingLevel() {},
          getLastAssistantText() {
            return `result-${index + 1}`;
          },
          getSessionStats() {
            return {
              tokens: {
                input: 10 * (index + 1),
                output: index + 1,
                cacheRead: 0,
                cacheWrite: 0,
                total: 11 * (index + 1),
              },
              cost: 0.001 * (index + 1),
            };
          },
        } as unknown as AgentSession;
      },
    });
    const tool = registerSubagent(extension);

    expect((tool.parameters as any).properties.task).toBeDefined();
    expect((tool.parameters as any).properties.tasks).toBeUndefined();
    const results = await Promise.all(['first', 'second', 'third'].map((task, index) => (
      tool.execute(
        `call-${index + 1}`,
        { task, capability: 'read_only' },
        undefined,
        undefined,
        { model: undefined } as ExtensionContext,
      )
    )));

    expect(tool.executionMode).toBe('parallel');
    expect(sessionIndex).toBe(3);
    expect(results.map(result => result.details)).toMatchObject([
      { result: { task: 'first', output: 'result-1', status: 'completed' } },
      { result: { task: 'second', output: 'result-2', status: 'completed' } },
      { result: { task: 'third', output: 'result-3', status: 'completed' } },
    ]);
  });

  test('runs at most two read-only tasks concurrently', async () => {
    let active = 0;
    let peak = 0;
    const extension = createSubagentExtension({
      cwd: '/workspace',
      agentDir: '/agent',
      authStorage: {} as never,
      modelRegistry: {} as never,
      toolDefinitions: ['read', 'grep', 'find', 'ls'].map(name => ({
        name,
        label: name,
        description: name,
        parameters: Type.Object({}),
        async execute() {
          return { content: [{ type: 'text', text: 'ok' }] };
        },
      })),
      createSessionHooks: () => ({
        name: 'test-hooks',
        factory() {},
      }),
      async createSession() {
        return {
          async prompt() {
            active += 1;
            peak = Math.max(peak, active);
            await Promise.resolve();
            active -= 1;
          },
          async waitForIdle() {},
          async abort() {},
          dispose() {},
          getLastAssistantText() {
            return 'done';
          },
          getSessionStats() {
            return {
              tokens: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
              cost: 0,
            };
          },
        } as unknown as AgentSession;
      },
    });
    const tool = registerSubagent(extension);

    await Promise.all(['one', 'two', 'three', 'four'].map((task, index) => (
      tool.execute(
        `call-concurrent-${index}`,
        { task, capability: 'read_only' },
        undefined,
        undefined,
        { model: undefined } as ExtensionContext,
      )
    )));

    expect(peak).toBe(2);
  });

  test('limits subagent calls per assistant response and resets on the next turn', async () => {
    let created = 0;
    let startTurn = () => {};
    const extension = createSubagentExtension({
      cwd: '/workspace',
      agentDir: '/agent',
      authStorage: {} as never,
      modelRegistry: {} as never,
      toolDefinitions: [],
      createSessionHooks: () => ({ name: 'test-hooks', factory() {} }),
      async createSession() {
        created += 1;
        throw new Error('stop after policy check');
      },
    });
    const tool = registerSubagent(extension, handler => {
      startTurn = handler;
    });

    for (let index = 0; index < 4; index += 1) {
      await tool.execute(
        `call-${index}`,
        { task: `task-${index}`, capability: 'read_only' },
        undefined,
        undefined,
        { model: undefined } as ExtensionContext,
      );
    }
    const rejected = await tool.execute(
      'call-5',
      { task: 'task-5', capability: 'read_only' },
      undefined,
      undefined,
      { model: undefined } as ExtensionContext,
    );

    expect(created).toBe(4);
    expect(rejected).toMatchObject({
      isError: true,
      content: [{ text: 'A maximum of 4 subagent calls is allowed per assistant response' }],
    });

    startTurn();
    await tool.execute(
      'call-next-turn',
      { task: 'next turn', capability: 'read_only' },
      undefined,
      undefined,
      { model: undefined } as ExtensionContext,
    );
    expect(created).toBe(5);
  });

  test('runs one workspace-write task with the fixed write toolset', async () => {
    let activeTools: string[] | undefined;
    let prompt = '';
    const extension = createSubagentExtension({
      cwd: '/workspace',
      agentDir: '/agent',
      authStorage: {} as never,
      modelRegistry: {} as never,
      toolDefinitions: ['read', 'grep', 'find', 'ls', 'edit', 'write', 'bash'].map(
        name => ({
          name,
          label: name,
          description: name,
          parameters: Type.Object({}),
          async execute() {
            return { content: [{ type: 'text', text: 'ok' }] };
          },
        }),
      ),
      createSessionHooks: () => ({
        name: 'test-hooks',
        factory() {},
      }),
      async createSession(options) {
        activeTools = options.tools;
        return {
          async prompt(value: string) {
            prompt = value;
          },
          async waitForIdle() {},
          async abort() {},
          dispose() {},
          getLastAssistantText() {
            return 'Updated the file.';
          },
          getSessionStats() {
            return {
              tokens: {
                input: 1,
                output: 1,
                cacheRead: 0,
                cacheWrite: 0,
                total: 2,
              },
              cost: 0,
            };
          },
        } as unknown as AgentSession;
      },
    });
    const tool = registerSubagent(extension);

    const result = await tool.execute(
      'call-write',
      {
        task: 'Update the file.',
        capability: 'workspace_write',
      } as never,
      undefined,
      undefined,
      { model: undefined } as ExtensionContext,
    );

    expect(activeTools).toEqual([
      'read',
      'grep',
      'find',
      'ls',
      'web_search',
      'web_fetch',
      'edit',
      'write',
      'bash',
    ]);
    expect(prompt).not.toContain('Do not modify files');
    expect(result.details).toMatchObject({
      result: {
        capability: 'workspace_write',
        status: 'completed',
        output: 'Updated the file.',
      },
    });
  });

  test('rejects workspace-write mixed with sibling subagents', async () => {
    let created = 0;
    const extension = createSubagentExtension({
      cwd: '/workspace',
      agentDir: '/agent',
      authStorage: {} as never,
      modelRegistry: {} as never,
      toolDefinitions: [],
      createSessionHooks: () => ({
        name: 'test-hooks',
        factory() {},
      }),
      async createSession() {
        created += 1;
        throw new Error('must not create a session');
      },
    });
    const tool = registerSubagent(extension);

    const inspect = tool.execute(
      'call-inspect',
      { task: 'inspect', capability: 'read_only' },
      undefined,
      undefined,
      { model: undefined } as ExtensionContext,
    );
    const result = await tool.execute(
      'call-modify',
      { task: 'modify', capability: 'workspace_write' },
      undefined,
      undefined,
      { model: undefined } as ExtensionContext,
    );

    await inspect;
    expect(created).toBe(1);
    expect(result).toMatchObject({
      isError: true,
      details: {
        kind: 'storyflow-subagent',
      },
    });
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: 'workspace_write must be the only subagent call in an assistant response',
    });
  });

  test('aborts and disposes every active session when the parent signal is cancelled', async () => {
    const activeSessions = new Set<AgentSession>();
    const controller = new AbortController();
    let releasePrompt: (() => void) | undefined;
    let startedResolve: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    let aborted = 0;
    let disposed = 0;
    const extension = createSubagentExtension({
      cwd: '/workspace',
      agentDir: '/agent',
      authStorage: {} as never,
      modelRegistry: {} as never,
      toolDefinitions: [],
      activeSessions,
      createSessionHooks: () => ({
        name: 'test-hooks',
        factory() {},
      }),
      async createSession() {
        return {
          async prompt() {
            startedResolve?.();
            await new Promise<void>((resolve) => {
              releasePrompt = resolve;
            });
          },
          async waitForIdle() {},
          async abort() {
            aborted += 1;
            releasePrompt?.();
          },
          dispose() {
            disposed += 1;
          },
          getLastAssistantText() {
            return undefined;
          },
          getSessionStats() {
            return {
              tokens: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
              cost: 0,
            };
          },
        } as unknown as AgentSession;
      },
    });
    const tool = registerSubagent(extension);

    const execution = tool.execute(
      'call-abort',
      {
        task: 'wait',
        capability: 'read_only',
      },
      controller.signal,
      undefined,
      { model: undefined } as ExtensionContext,
    );
    await started;
    controller.abort();
    setTimeout(() => releasePrompt?.(), 10);

    await expect(execution).rejects.toThrow('Subagent execution aborted');
    expect(aborted).toBe(1);
    expect(disposed).toBe(1);
    expect(activeSessions.size).toBe(0);
  });

  test('reports a failed read-only task without discarding successful siblings', async () => {
    let sessionIndex = 0;
    const extension = createSubagentExtension({
      cwd: '/workspace',
      agentDir: '/agent',
      authStorage: {} as never,
      modelRegistry: {} as never,
      toolDefinitions: [],
      createSessionHooks: () => ({
        name: 'test-hooks',
        factory() {},
      }),
      async createSession() {
        const index = sessionIndex++;
        if (index === 0) throw new Error('provider unavailable');
        return {
          async prompt() {},
          async waitForIdle() {},
          async abort() {},
          dispose() {},
          getLastAssistantText() {
            return index === 0 ? undefined : 'successful result';
          },
          getSessionStats() {
            return {
              tokens: {
                input: 5,
                output: index,
                cacheRead: 0,
                cacheWrite: 0,
                total: 5 + index,
              },
              cost: 0,
            };
          },
        } as unknown as AgentSession;
      },
    });
    const tool = registerSubagent(extension);

    const results = await Promise.all([
      tool.execute(
        'call-fails',
        { task: 'fails', capability: 'read_only' },
        undefined,
        undefined,
        { model: undefined } as ExtensionContext,
      ),
      tool.execute(
        'call-succeeds',
        { task: 'succeeds', capability: 'read_only' },
        undefined,
        undefined,
        { model: undefined } as ExtensionContext,
      ),
    ]);

    expect(results.map(result => result.isError)).toEqual([true, false]);
    expect(results.map(result => result.details)).toMatchObject([
      {
        result: {
          task: 'fails',
          status: 'failed',
          output: 'provider unavailable',
        },
      },
      {
        result: {
          task: 'succeeds',
          status: 'completed',
          output: 'successful result',
        },
      },
    ]);
  });

  test('treats a provider message error as a failed task', async () => {
    let listener: ((event: unknown) => void) | undefined;
    const extension = createSubagentExtension({
      cwd: '/workspace',
      agentDir: '/agent',
      authStorage: {} as never,
      modelRegistry: {} as never,
      toolDefinitions: [],
      createSessionHooks: () => ({
        name: 'test-hooks',
        factory() {},
      }),
      async createSession() {
        return {
          subscribe(next: (event: unknown) => void) {
            listener = next;
            return () => {
              listener = undefined;
            };
          },
          async prompt() {
            listener?.({
              type: 'message_end',
              message: {
                role: 'assistant',
                stopReason: 'error',
                errorMessage: 'model authentication failed',
              },
            });
          },
          async waitForIdle() {},
          async abort() {},
          dispose() {},
          getLastAssistantText() {
            return undefined;
          },
          getSessionStats() {
            return {
              tokens: {
                input: 2,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 2,
              },
              cost: 0,
            };
          },
        } as unknown as AgentSession;
      },
    });
    const tool = registerSubagent(extension);

    const result = await tool.execute(
      'call-provider-error',
      {
        task: 'inspect',
        capability: 'read_only',
      },
      undefined,
      undefined,
      { model: undefined } as ExtensionContext,
    );

    expect(result).toMatchObject({
      isError: true,
      details: {
        result: {
          status: 'failed',
          output: 'model authentication failed',
        },
      },
    });
  });

  test('clears an intermediate provider error after Pi retries successfully', async () => {
    let listener: ((event: unknown) => void) | undefined;
    const extension = createSubagentExtension({
      cwd: '/workspace',
      agentDir: '/agent',
      authStorage: {} as never,
      modelRegistry: {} as never,
      toolDefinitions: [],
      createSessionHooks: () => ({ name: 'test-hooks', factory() {} }),
      async createSession() {
        return {
          subscribe(next: (event: unknown) => void) {
            listener = next;
            return () => { listener = undefined; };
          },
          async prompt() {
            listener?.({
              type: 'message_end',
              message: { role: 'assistant', stopReason: 'error', errorMessage: 'HTTP 520' },
            });
            listener?.({
              type: 'message_end',
              message: { role: 'assistant', stopReason: 'stop' },
            });
          },
          async waitForIdle() {},
          async abort() {},
          dispose() {},
          getLastAssistantText() { return 'Recovered result.'; },
          getSessionStats() {
            return {
              tokens: { input: 2, output: 1, cacheRead: 0, cacheWrite: 0, total: 3 },
              cost: 0,
            };
          },
        } as unknown as AgentSession;
      },
    });
    const tool = registerSubagent(extension);

    const result = await tool.execute(
      'call-provider-retry',
      { task: 'inspect', capability: 'read_only' },
      undefined,
      undefined,
      { model: undefined } as ExtensionContext,
    );

    expect(result.details).toMatchObject({
      result: { status: 'completed', output: 'Recovered result.' },
    });
  });
});
