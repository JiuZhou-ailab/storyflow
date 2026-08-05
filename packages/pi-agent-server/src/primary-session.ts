// input: Validated Pi init config, authenticated registry, Host tool bridges, and session paths
// output: One fully bound primary Pi AgentSession plus its system-prompt projection
// pos: Pi SDK session construction boundary, separate from JSONL command dispatch

import { join } from 'node:path';
import { mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import {
  createAgentSession,
  SessionManager as PiSessionManager,
  createReadToolDefinition,
  createBashToolDefinition,
  createEditToolDefinition,
  createGrepToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type {
  AgentSession,
  AuthStorage,
  CreateAgentSessionOptions,
  ModelRegistry,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { UserQuestionResponse } from '../../session-tools-core/src/types.ts';
import { getSessionPath } from '../../shared/src/sessions/storage.ts';
import type { PiInitMessage, PiOutboundMessage } from '../../shared/src/agent/backend/pi/protocol.ts';
import type { ConversationRewindBoundary } from '../../shared/src/agent/backend/types.ts';
import { createSearchTool } from './tools/search/create-search-tool.ts';
import { resolveSearchProvider } from './tools/search/resolve-provider.ts';
import { createWebFetchTool } from './tools/web-fetch.ts';
import { createCreateOnlyWriteToolDefinition } from './write-tool.ts';
import { createProjectResourceLoader } from './project-resource-loader.ts';
import { createExtensionUIContext } from './extension-ui.ts';
import { createSystemPromptOverride } from './system-prompt-override.ts';
import { createProviderHooks } from './provider-hooks.ts';
import {
  findProductRewindBoundary,
} from './product-rewind.ts';
import { createSubagentExtension, type SubagentHookContext } from './subagent-tool.ts';
import {
  sanitizeSessionFileForResume,
  type PiSessionSanitizeResult,
} from './pi-session-sanitizer.ts';
import { resolvePiModel } from './model-resolution.ts';
import type { createToolHooks } from './tool-hooks.ts';

interface PrimaryPiSessionContext {
  config: PiInitMessage;
  cwd: string;
  agentDir: string;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  thinkingLevel?: CreateAgentSessionOptions['thinkingLevel'];
  activeSubagentSessions: Set<AgentSession>;
  buildProxyTools(): ToolDefinition<any, any>[];
  prepareToolDefinitions(tools: ToolDefinition<any, any>[]): ToolDefinition<any, any>[];
  createSessionToolHooks(state: {
    getSession(): AgentSession | null;
    getUserRequest(): string;
    intentByCallId: Map<string, string>;
    toolResultTokens: number;
  }): ReturnType<typeof createToolHooks>;
  getCurrentUserMessage(): string;
  requestHostTool(toolName: string, args: Record<string, unknown>): Promise<{ content: string; isError: boolean }>;
  executeSessionRewind(
    session: AgentSession,
    targetId: string,
    options: Parameters<AgentSession['navigateTree']>[1],
    boundary: ConversationRewindBoundary,
  ): Promise<Awaited<ReturnType<AgentSession['navigateTree']>>>;
  handleShutdown(): void;
  send(message: PiOutboundMessage): void;
  debug(message: string): void;
}

function findMostRecentSessionFile(sessionDir: string): string | null {
  if (!existsSync(sessionDir)) return null;
  let best: { path: string; mtime: number } | null = null;
  for (const entry of readdirSync(sessionDir)) {
    if (!entry.endsWith('.jsonl')) continue;
    const fullPath = join(sessionDir, entry);
    const mtime = statSync(fullPath).mtimeMs;
    if (!best || mtime > best.mtime) best = { path: fullPath, mtime };
  }
  return best?.path ?? null;
}

function logSanitizeResult(debug: (message: string) => void, scope: string, result: PiSessionSanitizeResult): void {
  if (!result.changed) return;
  debug(`${scope}: removed ${result.removedToolCalls} incomplete tool call(s), normalized ${result.normalizedToolCalls} tool call(s)`);
}

export async function createPrimaryPiSession(context: PrimaryPiSessionContext): Promise<{
  session: AgentSession;
  systemPromptOverride: ReturnType<typeof createSystemPromptOverride>;
}> {
  const {
    config,
    cwd,
    agentDir,
    authStorage,
    modelRegistry,
    thinkingLevel: piThinkingLevel,
    activeSubagentSessions,
    buildProxyTools,
    prepareToolDefinitions,
    createSessionToolHooks,
    getCurrentUserMessage,
    requestHostTool,
    executeSessionRewind,
    handleShutdown,
    send,
    debug: debugLog,
  } = context;
  let activeSession: AgentSession | null = null;
  // Search is an independent capability: use its own AnySearch credential when
  // configured, otherwise the credential-free DuckDuckGo fallback.
  const searchProvider = {
    get name() {
      return resolveSearchProvider().name;
    },
    async search(query: string, count: number) {
      return resolveSearchProvider().search(query, count);
    },
  };
  const searchTool = createSearchTool(searchProvider);
  const webFetchTool = createWebFetchTool(() =>
    config ? getSessionPath(config.workspaceRootPath, config.sessionId) : null
  );
  const webTools = [searchTool, webFetchTool];

  // Pi SDK registration contract:
  //   - `customTools` accepts ToolDefinition[] — our schema-adapted objects go here
  //   - `tools` is a string[] name allowlist — MUST include every tool we want active,
  //     otherwise Pi SDK defaults to the built-in [read, bash, edit, write] set and
  //     silently filters out everything else. Custom tool names with matching built-in
  //     names override the SDK's raw implementation inside _refreshToolRegistry, so
  //     our hooked versions take effect (permissions + large-response summarization).
  //   - Do NOT pass tool *objects* to `tools` — `allowedToolNames = new Set(options.tools)`
  //     then `.has(name)` returns false for every string lookup → zero tools active.
  const builtinDefs = [
    createReadToolDefinition(cwd),
    createBashToolDefinition(cwd),
    createEditToolDefinition(cwd),
    createCreateOnlyWriteToolDefinition(cwd),
    createGrepToolDefinition(cwd),
    createFindToolDefinition(cwd),
    createLsToolDefinition(cwd),
  ];
  const proxyTools = buildProxyTools();
  const allTools = prepareToolDefinitions([...builtinDefs, ...webTools, ...proxyTools]);
  const toolAllowlist = allTools.map(t => t.name);
  const systemPromptOverride = createSystemPromptOverride();
  const toolHooks = createSessionToolHooks({
    getSession: () => activeSession,
    getUserRequest: getCurrentUserMessage,
    intentByCallId: new Map(),
    toolResultTokens: 0,
  });
  const providerHooks = createProviderHooks({
    enable1MContext: config.enable1MContext === true,
  });
  const subagentExtension = createSubagentExtension({
    cwd,
    agentDir,
    authStorage,
    modelRegistry,
    thinkingLevel: piThinkingLevel,
    toolDefinitions: allTools,
    activeSessions: activeSubagentSessions,
    providerHooks,
    createSessionHooks: (context: SubagentHookContext) => createSessionToolHooks({
      getSession: () => context.session,
      getUserRequest: () => context.userRequest,
      intentByCallId: new Map(),
      toolResultTokens: 0,
    }),
  });
  debugLog(`Session tools: ${builtinDefs.length} builtin + ${webTools.length} web + ${proxyTools.length} proxy = ${allTools.length} total`);

  // Build session options
  const sessionOptions: CreateAgentSessionOptions = {
    cwd,
    authStorage,
    modelRegistry,
    customTools: allTools,
    tools: toolAllowlist,
    agentDir,
    ...(piThinkingLevel ? { thinkingLevel: piThinkingLevel } : {}),
  };

  // Every session uses the explicit Storyflow ResourceLoader so prompt and
  // permission hooks cannot be bypassed by non-persisted/free contexts.
  const { resourceLoader, settingsManager } = await createProjectResourceLoader({
    cwd,
    agentDir,
    extensionFactories: [
      systemPromptOverride.extension,
      providerHooks,
      toolHooks,
      subagentExtension,
    ],
  });
  sessionOptions.resourceLoader = resourceLoader;
  sessionOptions.settingsManager = settingsManager;

  const extensionToolNames = new Set<string>();
  const loadedExtensions = resourceLoader.getExtensions();
  debugLog(
    `Loaded Pi Extensions: ${loadedExtensions.extensions.map(extension => extension.path).join(', ') || '(none)'}`,
  );
  for (const error of loadedExtensions.errors) {
    debugLog(`Pi Extension load error (${error.path}): ${error.error}`);
  }
  for (const extension of loadedExtensions.extensions) {
    for (const toolName of extension.tools.keys()) {
      if (
        toolName === 'subagent'
        && extension.path !== '<inline:storyflow-subagent>'
      ) {
        throw new Error(
          `Global Extension tool conflicts with the built-in Storyflow subagent: ${extension.path}`,
        );
      }
      if (toolAllowlist.includes(toolName)) {
        throw new Error(
          `Global Extension tool conflicts with a Storyflow tool: ${toolName}`,
        );
      }
      extensionToolNames.add(toolName);
    }
  }
  sessionOptions.tools = [...toolAllowlist, ...extensionToolNames];

  if (config.sessionPath) {
    // Session resume: use a per-Craft-session directory so the Pi SDK can
    // persist and resume its own session across subprocess restarts.
    // continueRecent() loads the existing session if one exists, otherwise
    // creates a new one — so this handles both first-run and resume.
    const sessionDir = join(config.sessionPath, '.pi-sessions');
    mkdirSync(sessionDir, { recursive: true });

    if (config.branchFromSessionPath) {
      // Branching: fork from the parent session's Pi session file.
      // Branches must not silently degrade to fresh sessions.
      const parentPiSessionDir = join(config.branchFromSessionPath, '.pi-sessions');
      const parentPiSessionFile = findMostRecentSessionFile(parentPiSessionDir);
      if (!parentPiSessionFile) {
        throw new Error(`Pi branch preflight failed: no parent Pi session file found in ${parentPiSessionDir}`);
      }

      debugLog(`Forking Pi session from parent: ${parentPiSessionFile}`);
      logSanitizeResult(
        debugLog,
        `Sanitized parent Pi session before fork (${parentPiSessionFile})`,
        sanitizeSessionFileForResume(parentPiSessionFile),
      );
      const forkedSessionManager = PiSessionManager.forkFrom(parentPiSessionFile, cwd, sessionDir);

      // Strict branch cutoff: move leaf to the selected parent entry if provided.
      // This is Pi's equivalent of Claude resumeSessionAt.
      if (config.branchFromSdkTurnId) {
        const anchorId = config.branchFromSdkTurnId;
        const anchorEntry = forkedSessionManager.getEntry(anchorId);
        if (!anchorEntry) {
          throw new Error(`Pi branch preflight failed: branch anchor not found: ${anchorId}`);
        }
        forkedSessionManager.branch(anchorId);
        debugLog(`Applied Pi branch cutoff at entry: ${anchorId}`);
      }

      sessionOptions.sessionManager = forkedSessionManager;
    } else {
      const recentPiSessionFile = findMostRecentSessionFile(sessionDir);
      if (recentPiSessionFile) {
        logSanitizeResult(
          debugLog,
          `Sanitized Pi session before resume (${recentPiSessionFile})`,
          sanitizeSessionFileForResume(recentPiSessionFile),
        );
      }
      sessionOptions.sessionManager = PiSessionManager.continueRecent(cwd, sessionDir);
    }
  }

  // Set model if specified
  if (config.model) {
    try {
      const piModel = resolvePiModel(
        modelRegistry,
        config.model,
        config.piAuth?.provider,
        Boolean(config.customEndpoint && config.baseUrl?.trim()),
      );
      if (piModel) {
        // Verify resolved model's provider is compatible with the authenticated provider.
        // Without this, a model that resolves to a different provider (e.g. azure-openai-responses
        // when authed as github-copilot) would cause "No API key found" at runtime.
        const resolvedProvider = (piModel as any)?.provider;
        const isCompatible = !config.piAuth ||
          resolvedProvider === config.piAuth.provider ||
          resolvedProvider === 'custom-endpoint';
        if (isCompatible) {
          sessionOptions.model = piModel;
        } else {
          debugLog(`Model ${config.model} resolved to incompatible provider ${resolvedProvider} (expected ${config.piAuth!.provider}), skipping`);
        }
      }
    } catch {
      debugLog(`Could not resolve Pi model: ${config.model}`);
    }
  }

  // Create the session — tools flow through customTools + allowlist (see comment above).
  const { session } = await createAgentSession(sessionOptions);
  activeSession = session;

  const notifyExtension = (
    message: string,
    level?: 'info' | 'warning' | 'error',
  ): void => send({ type: 'extension_notification', message, level });

  try {
    await session.bindExtensions({
      uiContext: createExtensionUIContext(
        session.extensionRunner.getUIContext(),
        {
          askUserQuestion: async (question) => {
            const result = await requestHostTool('mcp__session__ask_user_question', {
              questions: [question],
            });
            if (result.isError) throw new Error(result.content);

            const parsed = JSON.parse(result.content) as unknown;
            if (
              !parsed
              || typeof parsed !== 'object'
              || !('answers' in parsed)
              || !parsed.answers
              || typeof parsed.answers !== 'object'
            ) {
              throw new Error('Host returned an invalid user-question response.');
            }
            return parsed as UserQuestionResponse;
          },
          notify: notifyExtension,
        },
      ),
      mode: 'rpc',
      commandContextActions: {
        waitForIdle: () => session.waitForIdle(),
        newSession: async () => ({ cancelled: true }),
        fork: async () => ({ cancelled: true }),
        navigateTree: async (targetId, options) => {
          const target = session.sessionManager.getEntry(targetId);
          if (target?.type !== 'message' || target.message.role !== 'user') {
            throw new Error('Storyflow currently supports Extension tree navigation only to mapped user messages.');
          }

          const boundary = findProductRewindBoundary(
            session.sessionManager.getEntries(),
            { userEntryId: targetId },
          );
          if (!boundary) {
            throw new Error('This checkpoint predates safe Storyflow rewind mapping and cannot be restored.');
          }

          const projection = {
            retainThroughMessageId: boundary.retainThroughMessageId,
            ...(boundary.draftText !== undefined ? { draftText: boundary.draftText } : {}),
          };
          return executeSessionRewind(session, targetId, options, projection);
        },
        switchSession: async () => ({ cancelled: true }),
        reload: () => session.reload(),
      },
      abortHandler: () => {
        void session.abort();
      },
      shutdownHandler: handleShutdown,
      onError: (error) => {
        notifyExtension(
          `Extension ${error.extensionPath} failed during ${error.event}: ${error.error}`,
          'error',
        );
      },
    });
    debugLog(
      `Pi Extension commands: ${session.extensionRunner.getRegisteredCommands().map(command => command.invocationName).join(', ') || '(none)'}`,
    );
  } catch (error) {
    session.dispose();
    throw error;
  }

  debugLog(`Created Pi session: ${session.sessionId} (${allTools.length} tools)`);

  // Notify main process of session ID
  send({ type: 'session_id_update', sessionId: session.sessionId });

  return { session, systemPromptOverride };
}
