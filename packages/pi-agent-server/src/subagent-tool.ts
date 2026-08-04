// input: Parent Pi runtime dependencies, a delegated task, and a fixed capability profile
// output: A Pi Extension tool that runs an isolated in-memory AgentSession and returns its result
// pos: Built-in transient execution boundary between the parent Agent and host-governed subagents

import { Type } from '@sinclair/typebox';
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type AuthStorage,
  type CreateAgentSessionOptions,
  type InlineExtension,
  type ModelRegistry,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import {
  PI_SUBAGENT_DETAILS_KIND,
  type PiSubagentDetails,
  type PiSubagentTaskResult,
  type PiSubagentUsage,
} from '../../shared/src/agent/backend/pi/subagent-contract.ts';
import { createStoryflowRetrySettings } from './project-resource-loader.ts';

const READ_ONLY_TOOLS = ['read', 'grep', 'find', 'ls', 'web_search', 'web_fetch'] as const;
const WORKSPACE_WRITE_TOOLS = [...READ_ONLY_TOOLS, 'edit', 'write', 'bash'] as const;
const MAX_CONCURRENT_TASKS = 2;
const MAX_TASKS_PER_TURN = 4;

type SubagentCapability = 'read_only' | 'workspace_write';

const SubagentParameters = Type.Object({
  task: Type.String({
    minLength: 1,
    description: 'One self-contained task with a concrete expected result.',
  }),
  capability: Type.Union([
    Type.Literal('read_only'),
    Type.Literal('workspace_write'),
  ], {
    description: 'Host-enforced tools. Parallel sibling calls must all be read_only.',
  }),
}, { additionalProperties: false });

export interface SubagentHookContext {
  session: AgentSession | null;
  userRequest: string;
}

type SubagentUsage = PiSubagentUsage;
type SubagentResult = PiSubagentTaskResult;
export type SubagentDetails = PiSubagentDetails;

export interface CreateSubagentExtensionOptions {
  cwd: string;
  agentDir: string;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  toolDefinitions: ToolDefinition<any, any>[];
  activeSessions?: Set<AgentSession>;
  thinkingLevel?: Parameters<AgentSession['setThinkingLevel']>[0];
  createSessionHooks(context: SubagentHookContext): InlineExtension;
  providerHooks?: InlineExtension;
  createSession?: (options: CreateAgentSessionOptions) => Promise<AgentSession>;
}

const EMPTY_USAGE: SubagentUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
  modelCalls: 0,
};

function getUsage(session: AgentSession): SubagentUsage {
  const stats = session.getSessionStats();
  return {
    input: stats.tokens.input,
    output: stats.tokens.output,
    cacheRead: stats.tokens.cacheRead,
    cacheWrite: stats.tokens.cacheWrite,
    cost: stats.cost,
    modelCalls: stats.assistantMessages,
  };
}

function createConcurrencyGate(limit: number) {
  let active = 0;
  const waiters: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
  }> = [];

  const wakeNext = () => {
    while (active < limit && waiters.length > 0) {
      const waiter = waiters.shift()!;
      if (waiter.signal?.aborted) {
        waiter.reject(new Error('Subagent execution aborted'));
        continue;
      }
      if (waiter.onAbort) {
        waiter.signal?.removeEventListener('abort', waiter.onAbort);
      }
      active += 1;
      waiter.resolve();
    }
  };

  return async function withConcurrencySlot<T>(
    signal: AbortSignal | undefined,
    run: () => Promise<T>,
  ): Promise<T> {
    if (signal?.aborted) throw new Error('Subagent execution aborted');

    if (active < limit) {
      active += 1;
    } else {
      await new Promise<void>((resolve, reject) => {
        const waiter: (typeof waiters)[number] = {
          resolve,
          reject,
          signal,
        };
        if (signal) {
          waiter.onAbort = () => {
            const index = waiters.indexOf(waiter);
            if (index !== -1) waiters.splice(index, 1);
            reject(new Error('Subagent execution aborted'));
          };
          signal.addEventListener('abort', waiter.onAbort, { once: true });
        }
        waiters.push(waiter);
      });
    }

    try {
      return await run();
    } finally {
      active -= 1;
      wakeNext();
    }
  };
}

export function createSubagentExtension(
  options: CreateSubagentExtensionOptions,
): InlineExtension {
  const createSession = options.createSession ?? (async sessionOptions => (
    await createAgentSession(sessionOptions)
  ).session);
  const withConcurrencySlot = createConcurrencyGate(MAX_CONCURRENT_TASKS);

  return {
    name: PI_SUBAGENT_DETAILS_KIND,
    factory(pi) {
      let callsThisTurn = 0;
      let turnCapability: SubagentCapability | undefined;
      pi.on('turn_start', () => {
        callsThisTurn = 0;
        turnCapability = undefined;
      });

      pi.registerTool({
        name: 'subagent',
        label: 'Subagent',
        description: 'Run one isolated temporary task with a host-enforced tool capability. Each call is one independently visible subagent.',
        promptSnippet: 'Run one isolated temporary task with host-limited tools.',
        promptGuidelines: [
          'Use subagent only for isolated temporary work that needs tools; use call_llm for tool-free reasoning and spawn_session for persistent user-visible work.',
          'For multiple independent tasks, emit one subagent call per task in the same assistant response. Never combine multiple tasks into one call, and use at most four calls per response.',
          'Parallel sibling calls must all use read_only. A workspace_write call must be the only subagent call in that assistant response.',
        ],
        executionMode: 'parallel',
        parameters: SubagentParameters,
        async execute(_toolCallId, params, signal, _onUpdate, ctx) {
          callsThisTurn += 1;
          const violatesTaskLimit = callsThisTurn > MAX_TASKS_PER_TURN;
          const mixesWorkspaceWrite = turnCapability !== undefined && (
            turnCapability === 'workspace_write'
            || params.capability === 'workspace_write'
          );
          if (violatesTaskLimit || mixesWorkspaceWrite) {
            const error = violatesTaskLimit
              ? `A maximum of ${MAX_TASKS_PER_TURN} subagent calls is allowed per assistant response`
              : 'workspace_write must be the only subagent call in an assistant response';
            return {
              content: [{ type: 'text', text: error }],
              details: {
                kind: PI_SUBAGENT_DETAILS_KIND,
                usage: EMPTY_USAGE,
              } satisfies SubagentDetails,
              isError: true,
            };
          }
          turnCapability = params.capability;

          const result = await withConcurrencySlot(signal, async (): Promise<SubagentResult> => {
            const allowedNames: string[] = params.capability === 'workspace_write'
              ? [...WORKSPACE_WRITE_TOOLS]
              : [...READ_ONLY_TOOLS];
            const hookContext: SubagentHookContext = {
              session: null,
              userRequest: params.task,
            };
            let session: AgentSession | null = null;
            let unsubscribe = () => {};
            let abortSession: (() => void) | undefined;
            let providerError = '';

            try {
              if (signal?.aborted) {
                throw new Error('Subagent execution aborted');
              }
              const settingsManager = SettingsManager.inMemory({ retry: createStoryflowRetrySettings() });
              const resourceLoader = new DefaultResourceLoader({
                cwd: options.cwd,
                agentDir: options.agentDir,
                settingsManager,
                extensionFactories: [
                  ...(options.providerHooks ? [options.providerHooks] : []),
                  options.createSessionHooks(hookContext),
                ],
                noExtensions: true,
                noSkills: true,
                noPromptTemplates: true,
                noThemes: true,
                noContextFiles: true,
              });
              await resourceLoader.reload();

              session = await createSession({
                cwd: options.cwd,
                agentDir: options.agentDir,
                authStorage: options.authStorage,
                modelRegistry: options.modelRegistry,
                model: ctx.model,
                thinkingLevel: options.thinkingLevel,
                customTools: options.toolDefinitions.filter(
                  tool => allowedNames.includes(tool.name),
                ),
                tools: allowedNames,
                sessionManager: SessionManager.inMemory(options.cwd),
                settingsManager,
                resourceLoader,
              });
              hookContext.session = session;
              options.activeSessions?.add(session);
              abortSession = () => {
                void session?.abort().catch(() => {});
              };
              signal?.addEventListener('abort', abortSession, { once: true });
              if (typeof session.subscribe === 'function') {
                unsubscribe = session.subscribe((event: AgentSessionEvent) => {
                  if (event.type !== 'message_end') return;
                  const message = event.message as {
                    role?: string;
                    stopReason?: string;
                    errorMessage?: string;
                  };
                  if (message.role !== 'assistant') return;
                  providerError = message.stopReason === 'error' && message.errorMessage
                    ? message.errorMessage
                    : '';
                });
              }

              if (signal?.aborted) {
                await session.abort();
                throw new Error('Subagent execution aborted');
              }
              await session.prompt([
                'Complete this isolated delegated task.',
                'Use only the available tools. Do not delegate or create sessions.',
                params.capability === 'read_only'
                  ? 'Do not modify files or external state.'
                  : 'Modify only what the task requires and verify the result.',
                `Task: ${params.task}`,
              ].join('\n'));
              if (signal?.aborted) {
                throw new Error('Subagent execution aborted');
              }
              if (providerError) {
                throw new Error(providerError);
              }

              return {
                task: params.task,
                capability: params.capability,
                status: 'completed',
                output: session.getLastAssistantText()?.trim() || '(no output)',
                usage: getUsage(session),
              };
            } catch (error) {
              if (signal?.aborted) {
                throw new Error('Subagent execution aborted');
              }
              return {
                task: params.task,
                capability: params.capability,
                status: 'failed',
                output: error instanceof Error ? error.message : String(error),
                usage: session ? getUsage(session) : EMPTY_USAGE,
              };
            } finally {
              unsubscribe();
              if (abortSession) {
                signal?.removeEventListener('abort', abortSession);
              }
              if (session) {
                options.activeSessions?.delete(session);
                session.dispose();
              }
            }
          });

          const details: SubagentDetails = {
            kind: PI_SUBAGENT_DETAILS_KIND,
            result,
            usage: result.usage,
          };

          return {
            content: [{ type: 'text', text: result.output }],
            details,
            isError: result.status === 'failed',
          };
        },
      });
    },
  };
}
