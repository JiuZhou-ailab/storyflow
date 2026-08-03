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

const READ_ONLY_TOOLS = ['read', 'grep', 'find', 'ls'] as const;
const WORKSPACE_WRITE_TOOLS = [...READ_ONLY_TOOLS, 'edit', 'write', 'bash'] as const;
const MAX_CONCURRENT_TASKS = 2;

const SubagentParameters = Type.Object({
  tasks: Type.Array(Type.Object({
    task: Type.String({
      minLength: 1,
      description: 'A self-contained task with a concrete expected result.',
    }),
    capability: Type.Union([
      Type.Literal('read_only'),
      Type.Literal('workspace_write'),
    ], {
      description: 'Host-enforced tools. read_only can be batched; workspace_write must be the only task.',
    }),
  }, { additionalProperties: false }), {
    minItems: 1,
    maxItems: 4,
    description: 'One task, or up to four independent read-only tasks.',
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
  createSession?: (options: CreateAgentSessionOptions) => Promise<AgentSession>;
}

function addUsage(left: SubagentUsage, right: SubagentUsage): SubagentUsage {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    cost: left.cost + right.cost,
    modelCalls: (left.modelCalls ?? 0) + (right.modelCalls ?? 0),
  };
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

async function mapWithConcurrencyLimit<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

export function createSubagentExtension(
  options: CreateSubagentExtensionOptions,
): InlineExtension {
  const createSession = options.createSession ?? (async sessionOptions => (
    await createAgentSession(sessionOptions)
  ).session);

  return {
    name: PI_SUBAGENT_DETAILS_KIND,
    factory(pi) {
      pi.registerTool({
        name: 'subagent',
        label: 'Subagent',
        description: 'Run isolated, temporary tasks with a host-enforced tool capability. Use this when a task needs separate context and tools but no persistent user-visible session.',
        promptSnippet: 'Run isolated temporary tasks with host-limited tools.',
        promptGuidelines: [
          'Use subagent only for isolated temporary work that needs tools; use call_llm for tool-free reasoning and spawn_session for persistent user-visible work.',
          'Batch only independent read_only tasks. workspace_write must be the only task.',
        ],
        executionMode: 'sequential',
        parameters: SubagentParameters,
        async execute(_toolCallId, params, signal, onUpdate, ctx) {
          if (
            params.tasks.length > 1
            && params.tasks.some(task => task.capability === 'workspace_write')
          ) {
            return {
              content: [{
                type: 'text',
                text: 'workspace_write must be the only task in a subagent call',
              }],
              details: {
                kind: PI_SUBAGENT_DETAILS_KIND,
                results: [],
                usage: EMPTY_USAGE,
              } satisfies SubagentDetails,
              isError: true,
            };
          }

          let completedTasks = 0;
          const completedResults: SubagentResult[] = [];
          const emitProgress = () => {
            onUpdate?.({
              content: [{
                type: 'text',
                text: `Subagents: ${completedTasks}/${params.tasks.length} completed`,
              }],
              details: {
                kind: PI_SUBAGENT_DETAILS_KIND,
                results: [...completedResults],
                usage: completedResults.reduce(
                  (usage, result) => addUsage(usage, result.usage),
                  EMPTY_USAGE,
                ),
              },
            });
          };
          const completeTask = (result: SubagentResult): SubagentResult => {
            completedResults.push(result);
            completedTasks += 1;
            emitProgress();
            return result;
          };
          emitProgress();

          const results = await mapWithConcurrencyLimit(
            params.tasks,
            MAX_CONCURRENT_TASKS,
            async (task): Promise<SubagentResult> => {
              const allowedNames: string[] = task.capability === 'workspace_write'
                ? [...WORKSPACE_WRITE_TOOLS]
                : [...READ_ONLY_TOOLS];
              const hookContext: SubagentHookContext = {
                session: null,
                userRequest: task.task,
              };
              let session: AgentSession | null = null;
              let unsubscribe = () => {};
              let abortSession: (() => void) | undefined;
              let providerError = '';

              try {
                if (signal?.aborted) {
                  throw new Error('Subagent execution aborted');
                }
                const settingsManager = SettingsManager.inMemory();
                const resourceLoader = new DefaultResourceLoader({
                  cwd: options.cwd,
                  agentDir: options.agentDir,
                  settingsManager,
                  extensionFactories: [options.createSessionHooks(hookContext)],
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
                    if (
                      message.role === 'assistant'
                      && message.stopReason === 'error'
                      && message.errorMessage
                    ) {
                      providerError = message.errorMessage;
                    }
                  });
                }

                if (signal?.aborted) {
                  await session.abort();
                  throw new Error('Subagent execution aborted');
                }
                if (ctx.model) {
                  await session.setModel(ctx.model);
                }
                if (options.thinkingLevel) {
                  session.setThinkingLevel(options.thinkingLevel);
                }
                await session.prompt([
                  'Complete this isolated delegated task.',
                  'Use only the available tools. Do not delegate or create sessions.',
                  task.capability === 'read_only'
                    ? 'Do not modify files or external state.'
                    : 'Modify only what the task requires and verify the result.',
                  `Task: ${task.task}`,
                ].join('\n'));
                await session.waitForIdle();
                if (signal?.aborted) {
                  throw new Error('Subagent execution aborted');
                }
                if (providerError) {
                  throw new Error(providerError);
                }

                return completeTask({
                  task: task.task,
                  capability: task.capability,
                  status: 'completed',
                  output: session.getLastAssistantText()?.trim() || '(no output)',
                  usage: getUsage(session),
                });
              } catch (error) {
                if (signal?.aborted) {
                  throw new Error('Subagent execution aborted');
                }
                return completeTask({
                  task: task.task,
                  capability: task.capability,
                  status: 'failed',
                  output: error instanceof Error ? error.message : String(error),
                  usage: session ? getUsage(session) : EMPTY_USAGE,
                });
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
            },
          );

          const details: SubagentDetails = {
            kind: PI_SUBAGENT_DETAILS_KIND,
            results,
            usage: results.reduce(
              (usage, result) => addUsage(usage, result.usage),
              EMPTY_USAGE,
            ),
          };

          return {
            content: [{
              type: 'text',
              text: results.map((result, index) => (
                `### Task ${index + 1} (${result.status})\n${result.output}`
              )).join('\n\n'),
            }],
            details,
            isError: results.every(result => result.status === 'failed'),
          };
        },
      });
    },
  };
}
