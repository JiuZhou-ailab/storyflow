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
): ToolDefinition<any, any> {
  let registered: ToolDefinition<any, any> | undefined;
  extension.factory({
    registerTool(tool) {
      registered = tool;
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
        createdOptions.push(options);
        return fakeSession;
      },
    });
    const tool = registerSubagent(extension);

    const result = await tool.execute(
      'call-1',
      {
        tasks: [{
          task: 'Inspect the runtime boundary.',
          capability: 'read_only',
        }],
      },
      undefined,
      undefined,
      {
        model: { provider: 'test', id: 'model' },
      } as ExtensionContext,
    );

    expect(createdOptions).toHaveLength(1);
    expect(createdOptions[0]?.tools).toEqual(['read', 'grep', 'find', 'ls']);
    expect(createdOptions[0]?.sessionManager?.isPersisted()).toBe(false);
    expect(createdOptions[0]?.settingsManager?.getRetrySettings()).toMatchObject({ maxRetries: 1 });
    expect(createdOptions[0]?.settingsManager?.getProviderRetrySettings()).toMatchObject({ maxRetries: 0 });
    expect(result.details).toMatchObject({
      kind: 'storyflow-subagent',
      results: [{
        capability: 'read_only',
        status: 'completed',
        output: 'Inspected the runtime boundary.',
      }],
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

  test('returns every read-only task in input order with aggregate usage', async () => {
    let sessionIndex = 0;
    const progress: string[] = [];
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

    const result = await tool.execute(
      'call-batch',
      {
        tasks: [
          { task: 'first', capability: 'read_only' },
          { task: 'second', capability: 'read_only' },
          { task: 'third', capability: 'read_only' },
        ],
      },
      undefined,
      update => {
        const text = update.content.find(part => part.type === 'text')?.text;
        if (text) progress.push(text);
      },
      { model: undefined } as ExtensionContext,
    );

    expect(sessionIndex).toBe(3);
    expect(result.details).toMatchObject({
      results: [
        { task: 'first', output: 'result-1', status: 'completed' },
        { task: 'second', output: 'result-2', status: 'completed' },
        { task: 'third', output: 'result-3', status: 'completed' },
      ],
      usage: {
        input: 60,
        output: 6,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.006,
      },
    });
    expect(progress[0]).toBe('Subagents: 0/3 completed');
    expect(progress.at(-1)).toBe('Subagents: 3/3 completed');
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

    await tool.execute(
      'call-concurrent',
      {
        tasks: ['one', 'two', 'three', 'four'].map(task => ({
          task,
          capability: 'read_only' as const,
        })),
      },
      undefined,
      undefined,
      { model: undefined } as ExtensionContext,
    );

    expect(peak).toBe(2);
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
        tasks: [{
          task: 'Update the file.',
          capability: 'workspace_write',
        }],
      } as never,
      undefined,
      undefined,
      { model: undefined } as ExtensionContext,
    );

    expect(activeTools).toEqual(['read', 'grep', 'find', 'ls', 'edit', 'write', 'bash']);
    expect(prompt).not.toContain('Do not modify files');
    expect(result.details).toMatchObject({
      results: [{
        capability: 'workspace_write',
        status: 'completed',
        output: 'Updated the file.',
      }],
    });
  });

  test('rejects batched workspace-write tasks before creating a session', async () => {
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

    const result = await tool.execute(
      'call-invalid-write-batch',
      {
        tasks: [
          { task: 'inspect', capability: 'read_only' },
          { task: 'modify', capability: 'workspace_write' },
        ],
      },
      undefined,
      undefined,
      { model: undefined } as ExtensionContext,
    );

    expect(created).toBe(0);
    expect(result).toMatchObject({
      isError: true,
      details: {
        kind: 'storyflow-subagent',
        results: [],
      },
    });
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: 'workspace_write must be the only task in a subagent call',
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
        tasks: [{ task: 'wait', capability: 'read_only' }],
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

    const result = await tool.execute(
      'call-partial-failure',
      {
        tasks: [
          { task: 'fails', capability: 'read_only' },
          { task: 'succeeds', capability: 'read_only' },
        ],
      },
      undefined,
      undefined,
      { model: undefined } as ExtensionContext,
    );

    expect(result.isError).toBeFalsy();
    expect(result.details).toMatchObject({
      results: [
        {
          task: 'fails',
          status: 'failed',
          output: 'provider unavailable',
        },
        {
          task: 'succeeds',
          status: 'completed',
          output: 'successful result',
        },
      ],
    });
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
        tasks: [{ task: 'inspect', capability: 'read_only' }],
      },
      undefined,
      undefined,
      { model: undefined } as ExtensionContext,
    );

    expect(result).toMatchObject({
      isError: true,
      details: {
        results: [{
          status: 'failed',
          output: 'model authentication failed',
        }],
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
      { tasks: [{ task: 'inspect', capability: 'read_only' }] },
      undefined,
      undefined,
      { model: undefined } as ExtensionContext,
    );

    expect(result.details).toMatchObject({
      results: [{ status: 'completed', output: 'Recovered result.' }],
    });
  });
});
