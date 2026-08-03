#!/usr/bin/env node
/**
 * input: JSONL control messages from the main process, Pi SDK session files, model credentials, and tool definitions.
 * output: JSONL agent events, tool requests, auth/test results, and Pi session state updates.
 * pos: Out-of-process Pi SDK adapter that isolates provider/runtime details from the Electron main process.
 *
 * Pi Agent Server
 *
 * Out-of-process Pi agent server communicating via JSONL over stdio.
 * Wraps @earendil-works/pi-coding-agent SDK and communicates with the main
 * Electron process using a line-delimited JSON protocol.
 *
 * The main process spawns this as a child process. All Pi SDK interactions
 * (session creation, prompting, tool execution, permissions) happen here,
 * with events forwarded back to the main process for UI rendering.
 *
 * This design isolates the Pi SDK's ESM + heavy dependencies into a
 * separate process, avoiding bundling issues in the Electron main process.
 */

import http from 'node:http';
import { join } from 'node:path';
import { mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';

// Pi SDK
import {
  createAgentSession,
  SessionManager as PiSessionManager,
  AuthStorage as PiAuthStorage,
  ModelRegistry as PiModelRegistry,
  DefaultResourceLoader,
  SettingsManager,
  createReadToolDefinition,
  createBashToolDefinition,
  createEditToolDefinition,
  createGrepToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
  getAgentDir,
} from '@earendil-works/pi-coding-agent';
import type {
  AgentSession,
  AgentSessionEvent,
  AgentToolResult,
  AuthCredential,
  CreateAgentSessionOptions,
  ToolCallEvent,
  ToolDefinition,
  ToolResultEvent,
} from '@earendil-works/pi-coding-agent';

// Pi AI types
import type {
  AssistantMessage,
  ImageContent as PiImageContent,
  TextContent as PiTextContent,
} from '@earendil-works/pi-ai';

// Pre-register the Bedrock provider module so the Pi SDK doesn't attempt a
// dynamic import of "./amazon-bedrock.js" — which fails in the bundled output
// because bun collapses everything into a single file.
// pi-ai is deduped (single hoisted copy), so one registration covers both
// pi-ai and pi-agent-core module scopes.
import { setBedrockProviderModule } from '@earendil-works/pi-ai/api/bedrock-converse-stream.lazy';
import { bedrockProviderModule } from '@earendil-works/pi-ai/bedrock-provider';
setBedrockProviderModule(bedrockProviderModule);

// Model resolution (extracted for testability + custom-endpoint precedence)
import { resolvePiModel, isDeniedMiniModelId, isModelNotFoundError } from './model-resolution.ts';
import { pickProviderAppropriateMiniModel } from './pick-mini-model.ts';
import {
  buildCustomEndpointModelDef,
  normalizeCustomEndpointModelEntry,
  resolveCustomEndpointProviderApiKey,
  resolveCustomEndpointProviderName,
  resolveRuntimeCredentialProviderNames,
  shouldUseCustomEndpointBearerAuthHeader,
  stripPiPrefix,
  type CustomEndpointModelConfig,
  type CustomEndpointModelEntry,
  type CustomEndpointModelOverrides,
} from './custom-endpoint-models.ts';

// Direct source imports from shared (bundled by bun build)
import { handleLargeResponse, estimateTokens, tokenLimitFor } from '../../shared/src/utils/large-response.ts';
import { getSessionPlansPath, getSessionPath } from '../../shared/src/sessions/storage.ts';
import { buildCallLlmRequest, withTimeout, LLM_QUERY_TIMEOUT_MS } from '../../shared/src/agent/llm-tool.ts';
import type { LLMQueryRequest, LLMQueryResult } from '../../shared/src/agent/llm-tool.ts';
import { readJsonLines } from '../../shared/src/utils/jsonl.ts';
import { PI_TOOL_NAME_MAP, THINKING_TO_PI } from '../../shared/src/agent/backend/pi/constants.ts';
import { getDefaultSummarizationModel } from '../../shared/src/config/models.ts';
import { createWebFetchTool } from './tools/web-fetch.ts';
import { resolveSearchProvider } from './tools/search/resolve-provider.ts';
import { createSearchTool } from './tools/search/create-search-tool.ts';
import { createCreateOnlyWriteToolDefinition } from './write-tool.ts';
import { createProjectResourceLoader } from './project-resource-loader.ts';
import { normalizeCraftToolArgumentsForSchema } from './craft-metadata-schema.ts';
import { createSystemPromptOverride } from './system-prompt-override.ts';
import { fingerprintTools } from './prompt-cache-profile.ts';
import { createToolHooks } from './tool-hooks.ts';
import { createProviderHooks } from './provider-hooks.ts';
import { installNetworkProxy } from './network-proxy.ts';
import {
  createSubagentExtension,
  type SubagentHookContext,
} from './subagent-tool.ts';
import {
  sanitizeAssistantMessageForResume,
  sanitizeSessionFileForResume,
  type PiSessionSanitizeResult,
} from './pi-session-sanitizer.ts';
import {
  createPromptAttemptState,
  isAnthropicMessageStopStreamError,
  recordPromptAttemptEvent,
  shouldAutoRetryPromptFailure,
  type PromptAttemptState,
} from './prompt-retry.ts';

installNetworkProxy();

// ============================================================
// Types — JSONL Protocol
// ============================================================

/** Credential union used in init and token_update messages */
type PiCredential =
  | { type: 'api_key'; key: string }
  | { type: 'oauth'; access: string; refresh: string; expires: number }
  | { type: 'iam'; accessKeyId: string; secretAccessKey: string; region?: string; sessionToken?: string };

/** Custom endpoint protocol — determines which streaming adapter Pi SDK uses */
type CustomEndpointApi =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generative-ai';

/** Init message from main process — configures the Pi agent server */
interface InitMessage {
  type: 'init';
  apiKey: string;
  model: string;
  cwd: string;
  thinkingLevel: string;
  workspaceRootPath: string;
  /** Explicit resource overlay root. Omit for global-only/free contexts. */
  projectRoot?: string;
  sessionId: string;
  sessionPath: string;
  workingDirectory: string;
  plansFolderPath: string;
  miniModel?: string;
  agentDir?: string;
  providerType?: string;
  authType?: string;
  workspaceId?: string;
  baseUrl?: string;
  branchFromSdkSessionId?: string;
  branchFromSessionPath?: string;
  branchFromSdkTurnId?: string;
  customEndpoint?: { api: CustomEndpointApi; supportsImages?: boolean };
  customModels?: CustomEndpointModelConfig[];
  piAuth?: { provider: string; credential: PiCredential };
  enable1MContext?: boolean;
}

interface RuntimeConfigUpdateMessage {
  type: 'update_runtime_config';
  id: string;
  model: string;
  providerType?: string;
  authType?: string;
  baseUrl?: string;
  customEndpoint?: { api: CustomEndpointApi; supportsImages?: boolean };
  customModels?: CustomEndpointModelConfig[];
}

/** Messages from main process (stdin) */
type InboundMessage =
  | InitMessage
  | { type: 'prompt'; id: string; message: string; systemPrompt: string; dynamicSystemPrompt?: string; images?: Array<{ type: 'image'; data: string; mimeType: string }> }
  | { type: 'register_tools'; tools: ProxyToolDef[] }
  | { type: 'tool_execute_response'; requestId: string; result: { content: string; isError: boolean } }
  | { type: 'pre_tool_use_response'; requestId: string; action: 'allow' | 'block' | 'modify'; input?: Record<string, unknown>; reason?: string }
  | { type: 'abort' }
  | { type: 'mini_completion'; id: string; prompt: string }
  | { type: 'llm_query'; id: string; request: LLMQueryRequest }
  | { type: 'ensure_session_ready'; id: string }
  | { type: 'set_model'; model: string }
  | { type: 'set_thinking_level'; level: string }
  | { type: 'compact'; id: string; customInstructions?: string }
  | { type: 'set_auto_compaction'; id: string; enabled: boolean }
  | { type: 'rewind_user_message'; id: string; userOrdinal: number }
  | RuntimeConfigUpdateMessage
  | { type: 'steer'; message: string }
  | { type: 'token_update'; piAuth: { provider: string; credential: PiCredential } }
  | { type: 'shutdown' };

/** Proxy tool definition from main process */
interface ProxyToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

type EnrichedAssistantMessageEndEvent = Extract<AgentSessionEvent, { type: 'message_end' }> & {
  sdkTurnAnchor?: string;
  contextWindow?: number;
};

type OutboundAgentEvent =
  | AgentSessionEvent
  | EnrichedAssistantMessageEndEvent;

/** Messages to main process (stdout) */
interface OutboundReady { type: 'ready'; sessionId: string | null; callbackPort: number }
interface OutboundEvent { type: 'event'; event: OutboundAgentEvent }
interface OutboundPreToolUseReq {
  type: 'pre_tool_use_request';
  requestId: string;
  toolName: string;
  toolCallId?: string;
  input: Record<string, unknown>;
}
interface OutboundToolExecReq { type: 'tool_execute_request'; requestId: string; toolName: string; args: Record<string, unknown> }
interface OutboundSessionToolCompleted { type: 'session_tool_completed'; toolName: string; args: Record<string, unknown>; isError: boolean }
interface OutboundMiniResult { type: 'mini_completion_result'; id: string; text: string | null }
interface OutboundLlmQueryResult {
  type: 'llm_query_result';
  id: string;
  result: LLMQueryResult | null;
  errorMessage?: string;
  /**
   * When set, signals the main process that a generic `error` with the same code
   * was also emitted on the error channel (for centralized auth-refresh detection).
   */
  errorCode?: string;
}
interface OutboundEnsureSessionReadyResult { type: 'ensure_session_ready_result'; id: string; sessionId: string | null }
interface OutboundCompactResult {
  type: 'compact_result';
  id: string;
  success: boolean;
  result?: { summary: string; firstKeptEntryId: string; tokensBefore: number };
  errorMessage?: string;
}
interface OutboundSetAutoCompactionResult {
  type: 'set_auto_compaction_result';
  id: string;
  success: boolean;
  enabled: boolean;
  errorMessage?: string;
}
interface OutboundRewindUserMessageResult {
  type: 'rewind_user_message_result';
  id: string;
  success: boolean;
  editorText?: string;
  errorMessage?: string;
}
interface OutboundRuntimeConfigUpdateResult {
  type: 'update_runtime_config_result';
  id: string;
  success: boolean;
  updated: boolean;
  errorMessage?: string;
}
interface OutboundSessionIdUpdate { type: 'session_id_update'; sessionId: string }
interface OutboundError { type: 'error'; message: string; code?: string }

type OutboundMessage =
  | OutboundReady
  | OutboundEvent
  | OutboundPreToolUseReq
  | OutboundToolExecReq
  | OutboundSessionToolCompleted
  | OutboundMiniResult
  | OutboundLlmQueryResult
  | OutboundEnsureSessionReadyResult
  | OutboundCompactResult
  | OutboundSetAutoCompactionResult
  | OutboundRewindUserMessageResult
  | OutboundRuntimeConfigUpdateResult
  | OutboundSessionIdUpdate
  | OutboundError;

// ============================================================
// State
// ============================================================

let piSession: AgentSession | null = null;
let piModelRegistry: PiModelRegistry | null = null;
let moduleAuthStorage: PiAuthStorage | null = null;
let unsubscribeEvents: (() => void) | null = null;
let systemPromptOverride: ReturnType<typeof createSystemPromptOverride> | null = null;

// Init config (set on 'init' message)
let initConfig: Extract<InboundMessage, { type: 'init' }> | null = null;

// Mutable state
let currentUserMessage = '';
let currentPromptAttemptState: PromptAttemptState | null = null;
let currentStablePrefixHash: string | null = null;
let currentToolsetHash: string | null = null;

// Pending promises for async handshakes
const pendingPreToolUse = new Map<string, { resolve: (response: { action: string; input?: Record<string, unknown>; reason?: string }) => void }>();
const pendingToolExecutions = new Map<string, { resolve: (result: { content: string; isError: boolean }) => void }>();
const activeSubagentSessions = new Set<AgentSession>();

// Pending session MCP tool calls for completion detection
const pendingSessionToolCalls = new Map<string, { toolName: string; arguments: Record<string, unknown> }>();

// Proxy tool definitions from main process
let proxyToolDefs: ProxyToolDef[] = [];

// Flag: proxy tools changed since last session creation — session needs recreation
let toolsChanged = false;

// Callback server for call_llm
let callbackServer: http.Server | null = null;
let callbackPort = 0;

// ============================================================
// JSONL I/O
// ============================================================

function send(msg: OutboundMessage): void {
  const line = JSON.stringify(msg);
  process.stdout.write(line + '\n');
}

function debugLog(message: string): void {
  // Write debug messages to stderr so they don't interfere with JSONL protocol
  process.stderr.write(`[pi-server] ${message}\n`);
}

function logSanitizeResult(scope: string, result: PiSessionSanitizeResult): void {
  if (!result.changed) return;
  debugLog(
    `${scope}: removed ${result.removedToolCalls} incomplete tool call(s), ` +
    `normalized ${result.normalizedToolCalls} tool call(s)`,
  );
}

/** Find the most recent .jsonl session file in a directory. */
function findMostRecentSessionFile(sessionDir: string): string | null {
  if (!existsSync(sessionDir)) return null;
  let best: { path: string; mtime: number } | null = null;
  for (const entry of readdirSync(sessionDir)) {
    if (!entry.endsWith('.jsonl')) continue;
    const fullPath = join(sessionDir, entry);
    const mtime = statSync(fullPath).mtimeMs;
    if (!best || mtime > best.mtime) {
      best = { path: fullPath, mtime };
    }
  }
  return best?.path ?? null;
}

// ============================================================
// Callback Server (for call_llm from session MCP server)
// ============================================================

async function startCallbackServer(): Promise<void> {
  if (callbackServer) return;

  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/call-llm') {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;

      debugLog('Received call_llm request via callback server');
      const result = await preExecuteCallLlm(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      debugLog(`call_llm via callback failed: ${msg}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: msg }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      callbackPort = typeof addr === 'object' && addr ? addr.port : 0;
      debugLog(`Callback server listening on 127.0.0.1:${callbackPort}`);
      resolve();
    });
    server.on('error', reject);
  });

  callbackServer = server;
}

function stopCallbackServer(): void {
  if (callbackServer) {
    callbackServer.close();
    callbackServer = null;
    callbackPort = 0;
  }
}

// ============================================================
// Pi Session Management
// ============================================================

function resolvedCwd(): string {
  const wd = initConfig?.cwd || initConfig?.workingDirectory || process.cwd();
  if (wd.startsWith('~/')) return join(homedir(), wd.slice(2));
  if (wd === '~') return homedir();
  return wd;
}

// Helper: derive preferCustomEndpoint flag from init config
function shouldPreferCustomEndpoint(): boolean {
  return Boolean(initConfig?.customEndpoint && initConfig?.baseUrl?.trim());
}

/**
 * Expose the active Pi model API/provider/base URL to the interceptor process.
 * This gives the interceptor a robust routing hint (instead of brittle URL-only matching).
 */
function setInterceptorApiHints(model: { api?: string; provider?: string; baseUrl?: string } | undefined): void {
  if (!model) {
    delete process.env.CRAFT_PI_MODEL_API;
    delete process.env.CRAFT_PI_MODEL_PROVIDER;
    delete process.env.CRAFT_PI_MODEL_BASE_URL;
    return;
  }

  process.env.CRAFT_PI_MODEL_API = model.api || '';
  process.env.CRAFT_PI_MODEL_PROVIDER = model.provider || '';
  process.env.CRAFT_PI_MODEL_BASE_URL = model.baseUrl || '';

  debugLog(
    `[interceptor-hint] api=${process.env.CRAFT_PI_MODEL_API || '-'} provider=${process.env.CRAFT_PI_MODEL_PROVIDER || '-'} baseUrl=${process.env.CRAFT_PI_MODEL_BASE_URL || '-'}`,
  );
}

/**
 * Resolve the API key for custom endpoint auth.
 * Returns empty string for local endpoints (Ollama etc.) that don't need auth.
 */
function resolveCustomEndpointApiKey(): string {
  if (initConfig?.piAuth?.credential?.type === 'api_key') {
    return initConfig.piAuth.credential.key;
  }
  const key = initConfig?.apiKey || '';
  if (!key && initConfig?.baseUrl) {
    debugLog('[custom-endpoint] Warning: no API key found; using placeholder key for provider registration');
  }
  return resolveCustomEndpointProviderApiKey({
    apiKey: key,
    baseUrl: initConfig?.baseUrl,
    authType: initConfig?.authType,
  });
}

function getCustomEndpointProviderName(): string {
  return resolveCustomEndpointProviderName(initConfig?.piAuth?.provider);
}

/** Model IDs currently registered under the custom-endpoint provider */
let customEndpointModelIds: Set<string> = new Set();

/**
 * Register (or re-register) the custom-endpoint provider with the given models.
 * Note: registerProvider replaces the entire provider, so we maintain a Set of all
 * known model IDs and always pass the full set.
 */
const customModelOverrides = new Map<string, CustomEndpointModelOverrides>();

function registerCustomEndpointModels(
  registry: PiModelRegistry,
  api: CustomEndpointApi,
  baseUrl: string,
  models: CustomEndpointModelEntry[],
): void {
  for (const m of models) {
    customEndpointModelIds.add(m.id);
    if (
      m.contextWindow
      || m.supportsImages !== undefined
      || m.supportsThinking !== undefined
      || m.thinkingLevelMap !== undefined
    ) {
      customModelOverrides.set(m.id, {
        ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
        ...(m.supportsImages !== undefined ? { supportsImages: m.supportsImages } : {}),
        ...(m.supportsThinking !== undefined ? { supportsThinking: m.supportsThinking } : {}),
        ...(m.thinkingLevelMap !== undefined ? { thinkingLevelMap: m.thinkingLevelMap } : {}),
      });
    }
  }
  const allIds = [...customEndpointModelIds];
  const providerName = getCustomEndpointProviderName();
  registry.registerProvider(providerName, {
    baseUrl,
    apiKey: resolveCustomEndpointApiKey(),
    api,
    authHeader: shouldUseCustomEndpointBearerAuthHeader(providerName),
    models: allIds.map(id => buildCustomEndpointModelDef(
      id,
      { supportsImages: initConfig?.customEndpoint?.supportsImages === true },
      customModelOverrides.get(id),
    )),
  });
  debugLog(`Registered custom endpoint provider=${providerName}: ${baseUrl} with ${allIds.length} model(s) [${allIds.join(', ')}], api: ${api}`);
}

/**
 * Create an in-memory auth storage pre-loaded with the user's credentials
 * and a model registry backed by it. Used by both the main session and
 * ephemeral queryLlm sessions.
 */
function createAuthenticatedRegistry(): {
  authStorage: PiAuthStorage;
  modelRegistry: PiModelRegistry;
} {
  // Reuse module-level authStorage if already created (allows token_update to mutate it).
  // Only create a new one on first call or after re-init.
  if (!moduleAuthStorage) {
    moduleAuthStorage = PiAuthStorage.inMemory();
  }
  const authStorage = moduleAuthStorage;
  const hasCustomEndpoint = !!initConfig?.baseUrl?.trim();
  if (initConfig?.piAuth) {
    const { provider, credential } = initConfig.piAuth;
    // Pi SDK 0.70.0's AuthCredential union (ApiKeyCredential | OAuthCredential) doesn't
    // include 'iam' as a first-class member, but the auth storage accepts it at runtime
    // — the Bedrock provider module reads AWS env directly; this `set` keeps Pi SDK's
    // internal provider-tracking consistent regardless of credential shape.
    const credentialProviders = resolveRuntimeCredentialProviderNames(
      provider,
      hasCustomEndpoint && !!initConfig.customEndpoint,
    );
    for (const credentialProvider of credentialProviders) {
      authStorage.set(credentialProvider, credential as unknown as AuthCredential);
    }
    debugLog(`Injected ${credential.type} credential for provider(s): ${credentialProviders.join(', ')}`);
  } else if (initConfig?.apiKey) {
    authStorage.set('anthropic', { type: 'api_key', key: initConfig.apiKey });
    debugLog('Injected API key into auth storage (legacy fallback)');
  }

  const modelRegistry = PiModelRegistry.inMemory(authStorage);

  // Register custom endpoint models dynamically via Pi SDK's registerProvider API.
  // This makes arbitrary provider-compatible endpoints work through the Pi SDK
  // by creating synthetic Model<Api> objects that the SDK requires.
  if (hasCustomEndpoint && initConfig?.customEndpoint) {
    const { api } = initConfig.customEndpoint;
    const modelEntries: CustomEndpointModelEntry[] = (initConfig.customModels?.length
      ? initConfig.customModels
      : [initConfig.model || 'default']
    ).map(normalizeCustomEndpointModelEntry);
    customEndpointModelIds = new Set();  // Reset on fresh registry creation
    registerCustomEndpointModels(modelRegistry, api, initConfig.baseUrl!.trim(), modelEntries);
  } else if (hasCustomEndpoint && !initConfig?.customEndpoint) {
    debugLog('Custom endpoint without protocol config — models may not resolve. Set customEndpoint.api for proper routing.');
  }

  return { authStorage, modelRegistry };
}

async function ensureSession(): Promise<AgentSession> {
  if (piSession) return piSession;
  if (!initConfig) throw new Error('Cannot create session: init not received');

  const cwd = resolvedCwd();
  const agentDir = initConfig.agentDir
    || (initConfig.sessionPath ? join(initConfig.sessionPath, '.pi-agent') : getAgentDir());
  mkdirSync(agentDir, { recursive: true });
  const piThinkingLevel = THINKING_TO_PI[
    initConfig.thinkingLevel as keyof typeof THINKING_TO_PI
  ];

  const { authStorage, modelRegistry } = createAuthenticatedRegistry();
  // Store at module scope for set_model handler
  piModelRegistry = modelRegistry;

  // Build tools: coding tools + web tools wrapped with permission hooks + proxy tools.
  // Search provider is selected based on the user's LLM connection:
  //   - OpenAI/OpenRouter → Responses API built-in web_search
  //   - ChatGPT Plus (openai-codex) → ChatGPT backend responses endpoint
  //   - Google → Gemini API with googleSearch grounding
  //   - Custom endpoints → AnySearch (never reuse custom model credentials)
  //   - Others → DuckDuckGo fallback
  //
  // IMPORTANT: resolve dynamically on each search call so token_update refreshes
  // are used without recreating the session.
  const searchProvider = {
    get name() {
      return resolveSearchProvider(initConfig?.piAuth, !!initConfig?.customEndpoint).name;
    },
    async search(query: string, count: number) {
      return resolveSearchProvider(
        initConfig?.piAuth,
        !!initConfig?.customEndpoint,
      ).search(query, count);
    },
  };
  const searchTool = createSearchTool(searchProvider);
  const webFetchTool = createWebFetchTool(() =>
    initConfig ? getSessionPath(initConfig.workspaceRootPath, initConfig.sessionId) : null
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
  systemPromptOverride = createSystemPromptOverride();
  const toolHooks = createSessionToolHooks({
    getSession: () => piSession,
    getUserRequest: () => currentUserMessage,
    intentByCallId: new Map(),
  });
  const providerHooks = createProviderHooks({
    enable1MContext: initConfig.enable1MContext === true,
  });
  const subagentExtension = createSubagentExtension({
    cwd,
    agentDir,
    authStorage,
    modelRegistry,
    thinkingLevel: piThinkingLevel,
    toolDefinitions: allTools,
    activeSessions: activeSubagentSessions,
    createSessionHooks: (context: SubagentHookContext) => createSessionToolHooks({
      getSession: () => context.session,
      getUserRequest: () => context.userRequest,
      intentByCallId: new Map(),
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
  for (const extension of resourceLoader.getExtensions().extensions) {
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

  if (initConfig.sessionPath) {
    // Session resume: use a per-Craft-session directory so the Pi SDK can
    // persist and resume its own session across subprocess restarts.
    // continueRecent() loads the existing session if one exists, otherwise
    // creates a new one — so this handles both first-run and resume.
    const sessionDir = join(initConfig.sessionPath, '.pi-sessions');
    mkdirSync(sessionDir, { recursive: true });

    if (initConfig.branchFromSessionPath) {
      // Branching: fork from the parent session's Pi session file.
      // Branches must not silently degrade to fresh sessions.
      const parentPiSessionDir = join(initConfig.branchFromSessionPath, '.pi-sessions');
      const parentPiSessionFile = findMostRecentSessionFile(parentPiSessionDir);
      if (!parentPiSessionFile) {
        throw new Error(`Pi branch preflight failed: no parent Pi session file found in ${parentPiSessionDir}`);
      }

      debugLog(`Forking Pi session from parent: ${parentPiSessionFile}`);
      logSanitizeResult(
        `Sanitized parent Pi session before fork (${parentPiSessionFile})`,
        sanitizeSessionFileForResume(parentPiSessionFile),
      );
      const forkedSessionManager = PiSessionManager.forkFrom(parentPiSessionFile, cwd, sessionDir);

      // Strict branch cutoff: move leaf to the selected parent entry if provided.
      // This is Pi's equivalent of Claude resumeSessionAt.
      if (initConfig.branchFromSdkTurnId) {
        const anchorId = initConfig.branchFromSdkTurnId;
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
          `Sanitized Pi session before resume (${recentPiSessionFile})`,
          sanitizeSessionFileForResume(recentPiSessionFile),
        );
      }
      sessionOptions.sessionManager = PiSessionManager.continueRecent(cwd, sessionDir);
    }
  }

  // Set model if specified
  if (initConfig.model) {
    try {
      const piModel = resolvePiModel(modelRegistry, initConfig.model, initConfig.piAuth?.provider, shouldPreferCustomEndpoint());
      if (piModel) {
        // Verify resolved model's provider is compatible with the authenticated provider.
        // Without this, a model that resolves to a different provider (e.g. azure-openai-responses
        // when authed as github-copilot) would cause "No API key found" at runtime.
        const resolvedProvider = (piModel as any)?.provider;
        const isCompatible = !initConfig.piAuth ||
          resolvedProvider === initConfig.piAuth.provider ||
          resolvedProvider === 'custom-endpoint';
        if (isCompatible) {
          sessionOptions.model = piModel;
          setInterceptorApiHints(piModel as { api?: string; provider?: string; baseUrl?: string });
        } else {
          debugLog(`Model ${initConfig.model} resolved to incompatible provider ${resolvedProvider} (expected ${initConfig.piAuth!.provider}), skipping`);
          setInterceptorApiHints(undefined);
        }
      } else {
        setInterceptorApiHints(undefined);
      }
    } catch {
      debugLog(`Could not resolve Pi model: ${initConfig.model}`);
      setInterceptorApiHints(undefined);
    }
  } else {
    setInterceptorApiHints(undefined);
  }

  // Create the session — tools flow through customTools + allowlist (see comment above).
  const { session } = await createAgentSession(sessionOptions);
  piSession = session;

  toolsChanged = false;
  debugLog(`Created Pi session: ${session.sessionId} (${allTools.length} tools)`);

  // Notify main process of session ID
  send({ type: 'session_id_update', sessionId: session.sessionId });

  return session;
}


// ============================================================
// Tool Hooks (Permission Enforcement + Large Response Summarization)
// ============================================================

interface SessionToolHookState {
  getSession(): AgentSession | null;
  getUserRequest(): string;
  intentByCallId: Map<string, string>;
}

function createSessionToolHooks(state: SessionToolHookState) {
  return createToolHooks({
    beforeToolCall: event => prepareToolInput(event, state.intentByCallId),
    afterToolCall: event => postprocessToolResult(event, state),
  });
}

/**
 * Shared permission enforcement for both coding tools and proxy tools.
 * Checks mode-manager rules and, in Ask mode, prompts the user via the
 * pending-permissions handshake. Throws on deny or block.
 */
/**
 * Send pre_tool_use_request to main process and wait for response.
 * Returns the (potentially modified) input if approved, throws if blocked.
 * All permission checking, transforms, and source activation happen in the main process.
 */
async function requestPreToolUseApproval(
  sdkToolName: string,
  input: Record<string, unknown>,
  toolCallId?: string,
): Promise<Record<string, unknown>> {
  const requestId = `pi-ptu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  send({
    type: 'pre_tool_use_request',
    requestId,
    toolName: sdkToolName,
    ...(toolCallId ? { toolCallId } : {}),
    input,
  });

  const response = await new Promise<{ action: string; input?: Record<string, unknown>; reason?: string }>((resolve) => {
    pendingPreToolUse.set(requestId, { resolve });
  });

  if (response.action === 'block') {
    throw new Error(response.reason || `Tool "${sdkToolName}" is not allowed`);
  }

  return response.action === 'modify' && response.input ? response.input : input;
}

function prepareToolDefinitions(tools: ToolDefinition<any, any>[]): ToolDefinition<any, any>[] {
  return tools.map((tool) => {
    const originalPrepareArguments = tool.prepareArguments;
    const prepareArguments: ToolDefinition<any, any>['prepareArguments'] = (args) => {
      const normalized = normalizeCraftToolArgumentsForSchema(tool.name, tool.parameters, args);
      return originalPrepareArguments ? originalPrepareArguments(normalized) : normalized;
    };

    return {
      ...tool,
      prepareArguments,
    };
  });
}

async function prepareToolInput(
  event: ToolCallEvent,
  intentByCallId: Map<string, string>,
): Promise<Record<string, unknown>> {
  const sdkToolName = PI_TOOL_NAME_MAP[event.toolName] || event.toolName;
  let input: Record<string, unknown> = { ...event.input };
  const intent = typeof input.description === 'string' ? input.description : undefined;

  // Normalize Pi SDK parameter names for the shared permission pipeline.
  if ((sdkToolName === 'Write' || sdkToolName === 'Edit' || sdkToolName === 'MultiEdit' || sdkToolName === 'NotebookEdit')
      && typeof input.path === 'string' && !input.file_path) {
    input = { ...input, file_path: input.path };
  }

  const approvedInput = await requestPreToolUseApproval(sdkToolName, input, event.toolCallId);
  if (intent) intentByCallId.set(event.toolCallId, intent);
  return approvedInput;
}

async function postprocessToolResult(
  event: ToolResultEvent,
  state: SessionToolHookState,
): Promise<{
  content?: (PiTextContent | PiImageContent)[];
  details?: unknown;
  isError?: boolean;
} | void> {
  const intent = state.intentByCallId.get(event.toolCallId);
  state.intentByCallId.delete(event.toolCallId);
  if (event.isError) return;

  const resultText = event.content
    .filter((content): content is PiTextContent => content.type === 'text')
    .map(content => content.text)
    .join('');
  const modelContextWindow = state.getSession()?.agent.state.model?.contextWindow;
  if (estimateTokens(resultText) <= tokenLimitFor(modelContextWindow) || !initConfig) {
    return;
  }

  try {
    const sdkToolName = PI_TOOL_NAME_MAP[event.toolName] || event.toolName;
    const largeResult = await handleLargeResponse({
      text: resultText,
      sessionPath: getSessionPath(initConfig.workspaceRootPath, initConfig.sessionId),
      context: {
        toolName: sdkToolName,
        input: event.input,
        intent,
        userRequest: state.getUserRequest(),
      },
      summarize: runMiniCompletion,
      contextWindow: modelContextWindow,
    });

    if (largeResult) {
      return {
        content: [{ type: 'text', text: largeResult.message }],
        details: event.details,
        isError: event.isError,
      };
    }
  } catch (error) {
    debugLog(
      `Large response handling failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ============================================================
// Proxy Tools (tools executed in main process)
// ============================================================

function buildProxyTools(): ToolDefinition<any, any>[] {
  debugLog(`Building proxy tools from ${proxyToolDefs.length} definitions: ${proxyToolDefs.map(t => t.name).join(', ')}`);

  return proxyToolDefs.map<ToolDefinition<any, any>>(def => ({
    name: def.name,
    label: def.name
      .replace(/^mcp__.*?__/, '')
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2'),
    description: def.description,
    // Pi SDK omits tools without promptSnippet from the system prompt's
    // "Available tools" section, making them invisible to the LLM.
    // Derive a snippet from the description so proxy tools are listed.
    promptSnippet: def.description.length > 200
      ? def.description.slice(0, 197) + '...'
      : def.description,
    parameters: def.inputSchema,
    execute: async (
      _toolCallId: string,
      params: any,
    ): Promise<AgentToolResult<any>> => {
      if (def.name === 'mcp__session__call_llm') {
        try {
          const result = await preExecuteCallLlm(params as Record<string, unknown>);
          return {
            content: [{ type: 'text', text: result.text || '(Model returned empty response)' }],
            details: result.warning ? { warning: result.warning } : undefined,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`call_llm failed: ${message}`);
        }
      }

      // Execute via main process
      const requestId = `proxy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      send({
        type: 'tool_execute_request',
        requestId,
        toolName: def.name,
        args: params as Record<string, unknown>,
      });

      const result = await new Promise<{ content: string; isError: boolean }>((resolve) => {
        pendingToolExecutions.set(requestId, { resolve });
      });

      return {
        content: [{ type: 'text', text: result.content }],
        details: result.isError ? { isError: true } : undefined,
      };
    },
  }));
}

// ============================================================
// LLM Query (ephemeral session for call_llm + mini completions)
// ============================================================

async function queryLlm(request: LLMQueryRequest): Promise<LLMQueryResult> {
  if (!initConfig) throw new Error('Cannot run queryLlm: init not received');

  debugLog('[queryLlm] Starting');
  const piThinkingLevel = THINKING_TO_PI[
    initConfig.thinkingLevel as keyof typeof THINKING_TO_PI
  ];

  // Pick mini model. If the configured miniModel uses a different provider than
  // what the user authenticated with (e.g. gemini-2.5-pro when only anthropic
  // credentials exist), fall back to the default summarization model which uses
  // the same provider family.
  let model = request.model ?? initConfig.miniModel ?? getDefaultSummarizationModel();

  // Create authenticated registry upfront — used by both the provider guard and the ephemeral session.
  const { authStorage, modelRegistry } = createAuthenticatedRegistry();

  const piAuthProvider = initConfig.piAuth?.provider;

  // If piAuth is set, ensure the mini model uses the same provider.
  // Pi SDK will fail with "No API key found" if the model requires a different provider.
  // Exception: 'custom-endpoint' provider is always compatible because it has its own
  // API key configured via resolveCustomEndpointApiKey() and doesn't use authStorage.
  if (initConfig.piAuth) {
    const authProvider = initConfig.piAuth.provider;
    const bareModel = model.startsWith('pi/') ? model.slice(3) : model;
    const resolved = resolvePiModel(modelRegistry, bareModel, authProvider, shouldPreferCustomEndpoint());
    const resolvedProvider = (resolved as any)?.provider;
    const isCompatible = resolvedProvider === authProvider || resolvedProvider === 'custom-endpoint';
    if (!resolved || !isCompatible || isDeniedMiniModelId(model, piAuthProvider)) {
      // Anthropic: keep Haiku (the cheap/fast mini). For every other provider
      // Haiku is unresolvable, so walk PI_PREFERRED_DEFAULTS for a model that
      // actually works under the user's auth.
      const providerDefault = authProvider === 'anthropic'
        ? undefined
        : pickProviderAppropriateMiniModel(authProvider, modelRegistry, shouldPreferCustomEndpoint());
      const fallback = providerDefault ?? getDefaultSummarizationModel();
      debugLog(`[queryLlm] Model ${bareModel} incompatible with ${authProvider} (resolved: ${resolvedProvider}), falling back to ${fallback}`);
      model = fallback;
    }
  }

  const runQueryWithModel = async (modelId: string): Promise<string> => {
    debugLog(`[queryLlm] Using model: ${modelId}`);

    // Resolve model — fail fast if unresolvable so we don't let the Pi SDK
    // fall back to its own internal default (which may require a provider
    // the user hasn't authenticated with, surfacing as a misleading
    // "No API key found for <provider>" error).
    const piModel = resolvePiModel(modelRegistry, modelId, initConfig!.piAuth?.provider, shouldPreferCustomEndpoint());
    if (!piModel) {
      throw new Error(
        `Could not resolve mini model "${modelId}" for provider "${initConfig!.piAuth?.provider ?? '(unknown)'}"`,
      );
    }

    // Create minimal ephemeral session
    const ephemeralOptions: CreateAgentSessionOptions = {
      cwd: resolvedCwd(),
      authStorage,
      modelRegistry,
      tools: [],
      sessionManager: PiSessionManager.inMemory(),
      model: piModel,
      ...(piThinkingLevel ? { thinkingLevel: piThinkingLevel } : {}),
    };
    const promptOverride = createSystemPromptOverride();
    const promptForSession =
      request.systemPrompt ?? 'Reply with ONLY the requested text. No explanation.';
    promptOverride.set(promptForSession);
    const resourceLoader = new DefaultResourceLoader({
      cwd: resolvedCwd(),
      agentDir: initConfig!.agentDir
        || (initConfig!.sessionPath ? join(initConfig!.sessionPath, '.pi-agent') : getAgentDir()),
      settingsManager: SettingsManager.inMemory(),
      extensionFactories: [promptOverride.extension],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await resourceLoader.reload();
    ephemeralOptions.resourceLoader = resourceLoader;

    const { session: ephemeralSession } = await createAgentSession(ephemeralOptions);

    // Pi SDK ignores options.model for ephemeral sessions (same issue as options.tools).
    // Explicitly set the model after creation to ensure the mini model is used.
    try {
      await ephemeralSession.setModel(piModel);
    } catch {
      debugLog(`[queryLlm] Failed to set model on ephemeral session, proceeding with default`);
    }

    debugLog(`[queryLlm] Created ephemeral session: ${ephemeralSession.sessionId}`);

    // Collect response text and errors from events
    let result = '';
    let lastError = '';
    let completionResolve: () => void;
    const completionPromise = new Promise<void>((resolve) => {
      completionResolve = resolve;
    });

    const unsub = ephemeralSession.subscribe((event: AgentSessionEvent) => {
      if (event.type === 'message_end') {
        // Only capture assistant messages — Pi SDK emits message_end for user messages too
        const msg = event.message as {
          role?: string;
          content?: string | Array<{ type: string; text?: string }>;
          stopReason?: string;
          errorMessage?: string;
        };
        if (msg.role !== 'assistant') return;

        // Capture API errors from message_end (e.g. auth failures, model errors)
        if (msg.stopReason === 'error' && msg.errorMessage) {
          lastError = msg.errorMessage;
          debugLog(`[queryLlm] API error in message_end: ${msg.errorMessage}`);
        }

        if (typeof msg.content === 'string') {
          result = msg.content;
        } else if (Array.isArray(msg.content)) {
          result = msg.content
            .filter((c) => c.type === 'text' && c.text)
            .map((c) => c.text!)
            .join('');
        }
      }
      if (event.type === 'agent_end') {
        completionResolve();
      }
    });

    try {
      await ephemeralSession.prompt(request.prompt);
      await withTimeout(
        completionPromise,
        LLM_QUERY_TIMEOUT_MS,
        `queryLlm timed out after ${LLM_QUERY_TIMEOUT_MS / 1000}s`
      );
      debugLog(`[queryLlm] Result length: ${result.trim().length}`);

      // If we got no text but captured an error, throw so callers see the real issue
      if (!result.trim() && lastError) {
        throw new Error(lastError);
      }

      return result.trim();
    } finally {
      unsub();
      ephemeralSession.dispose();
    }
  };

  const fallbackCandidates = [
    // Removed 'pi/gpt-5.1-codex-mini' (#596) — stale on several OpenAI catalogs.
    // The connection-configured miniModel is still tried via `initConfig.miniModel`.
    'pi/gpt-5-mini',
    initConfig.miniModel,
    getDefaultSummarizationModel(),
  ].filter((candidate): candidate is string => !!candidate && !isDeniedMiniModelId(candidate, piAuthProvider));

  const triedModels = new Set<string>();
  let currentModel = model;

  while (true) {
    triedModels.add(currentModel);
    try {
      const text = await runQueryWithModel(currentModel);
      return { text, model: currentModel };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const shouldRetry = isModelNotFoundError(errorMsg);

      if (!shouldRetry) {
        throw error;
      }

      const retryModel = fallbackCandidates.find(candidate => {
        if (triedModels.has(candidate)) return false;
        try {
          const resolved = resolvePiModel(modelRegistry, candidate, initConfig!.piAuth?.provider, shouldPreferCustomEndpoint());
          if (!resolved) return false;
          if (initConfig!.piAuth) {
            const rp = (resolved as any).provider;
            if (rp !== initConfig!.piAuth.provider && rp !== 'custom-endpoint') {
              return false;
            }
          }
          return true;
        } catch {
          return false;
        }
      });

      if (!retryModel) {
        throw error;
      }

      debugLog(`[queryLlm] Model ${currentModel} not found, retrying with ${retryModel}`);
      currentModel = retryModel;
    }
  }
}

async function preExecuteCallLlm(input: Record<string, unknown>): Promise<LLMQueryResult> {
  const sessionPath = initConfig
    ? getSessionPath(initConfig.workspaceRootPath, initConfig.sessionId)
    : undefined;
  const request = await buildCallLlmRequest(input, { backendName: 'Pi', sessionPath });
  return queryLlm(request);
}

async function runMiniCompletion(prompt: string): Promise<string | null> {
  try {
    const result = await queryLlm({ prompt });
    const text = result.text || null;
    debugLog(`[runMiniCompletion] Result: ${text ? `"${text.slice(0, 200)}"` : 'null'}`);
    return text;
  } catch (error) {
    debugLog(`[runMiniCompletion] Failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// ============================================================
// Event Handling
// ============================================================

function getAssistantErrorMessage(event: AgentSessionEvent): string | null {
  if (event.type !== 'message_end') return null;

  const msg = event.message as { role?: string; stopReason?: string; errorMessage?: string } | undefined;
  if (msg?.role !== 'assistant' || msg.stopReason !== 'error' || !msg.errorMessage) {
    return null;
  }

  return msg.errorMessage;
}

async function retryPromptFromCurrentTranscript(session: AgentSession): Promise<void> {
  const messages = session.agent.state.messages;
  const lastMessage = messages[messages.length - 1] as {
    role?: string;
    stopReason?: string;
    errorMessage?: string;
  } | undefined;

  if (
    lastMessage?.role === 'assistant' &&
    lastMessage.stopReason === 'error' &&
    isAnthropicMessageStopStreamError(lastMessage.errorMessage)
  ) {
    session.agent.state.messages = messages.slice(0, -1);
  }

  await session.agent.continue();

  const retryAwareSession = session as unknown as { waitForRetry?: () => Promise<void> };
  await retryAwareSession.waitForRetry?.();
}

function handleSessionEvent(event: AgentSessionEvent): void {
  const promptAttemptState = currentPromptAttemptState;
  if (promptAttemptState) {
    recordPromptAttemptEvent(promptAttemptState, event as unknown as Record<string, unknown>);

    const assistantErrorMessage = getAssistantErrorMessage(event);
    if (assistantErrorMessage && shouldAutoRetryPromptFailure(assistantErrorMessage, promptAttemptState)) {
      promptAttemptState.suppressedRetryableFailure = true;
      debugLog(`Suppressing retryable stream failure before automatic retry: ${assistantErrorMessage}`);
      return;
    }

    if (
      event.type === 'agent_end' &&
      promptAttemptState.suppressedRetryableFailure &&
      !promptAttemptState.retryAttempted
    ) {
      debugLog('Suppressing agent_end for retryable stream failure before automatic retry');
      return;
    }
  }

  let forwardedEvent: OutboundAgentEvent = event;

  // Log API errors for debugging and attach provider-native turn anchor for branch cutoffs.
  if (event.type === 'message_end') {
    const msg = event.message as AssistantMessage | undefined;
    if (msg?.stopReason === 'error') {
      debugLog(`API error in message_end: ${msg.errorMessage || 'unknown'}`);
    }

    if (msg?.role === 'assistant' && piSession) {
      const promptTokens = msg.usage.input + msg.usage.cacheRead + msg.usage.cacheWrite;
      const cacheHitRate = promptTokens > 0 ? msg.usage.cacheRead / promptTokens : 0;
      debugLog(
        `[prompt-cache] stable_prefix_hash=${currentStablePrefixHash ?? 'unknown'} ` +
        `toolset_hash=${currentToolsetHash ?? 'unknown'} prompt_tokens=${promptTokens} ` +
        `cache_read_tokens=${msg.usage.cacheRead} cache_write_tokens=${msg.usage.cacheWrite} ` +
        `cache_hit_rate=${cacheHitRate.toFixed(4)}`,
      );

      logSanitizeResult(
        'Sanitized assistant message before Pi persistence',
        sanitizeAssistantMessageForResume(event.message),
      );

      const sdkTurnAnchor = piSession.sessionManager.getLeafId();
      const contextWindow = piSession.agent.state.model?.contextWindow;
      forwardedEvent = {
        ...event,
        ...(sdkTurnAnchor ? { sdkTurnAnchor } : {}),
        ...(typeof contextWindow === 'number' && contextWindow > 0 ? { contextWindow } : {}),
      };
    }
  }

  // Detect session MCP tool completions.
  if (event.type === 'tool_execution_start') {
    const toolName = event.toolName;
    if (toolName.startsWith('session__') || toolName.startsWith('mcp__session__')) {
      const mcpToolName = toolName.replace(/^(mcp__session__|session__)/, '');
      pendingSessionToolCalls.set(event.toolCallId, {
        toolName: mcpToolName,
        arguments: (event.args ?? {}) as Record<string, unknown>,
      });
    }

  }

  if (event.type === 'tool_execution_end') {
    const pending = pendingSessionToolCalls.get(event.toolCallId);
    if (pending) {
      pendingSessionToolCalls.delete(event.toolCallId);
      send({
        type: 'session_tool_completed',
        toolName: pending.toolName,
        args: pending.arguments,
        isError: !!event.isError,
      });
    }
  }

  // Forward all events to main process
  send({ type: 'event', event: forwardedEvent });
}

// ============================================================
// Command Handlers
// ============================================================

async function handleInit(msg: Extract<InboundMessage, { type: 'init' }>): Promise<void> {
  await abortActiveSubagentSessions();

  // Clean up any existing session from a previous init
  if (piSession) {
    if (unsubscribeEvents) {
      unsubscribeEvents();
      unsubscribeEvents = null;
    }
    piSession.dispose();
    piSession = null;
    moduleAuthStorage = null; // Reset so createAuthenticatedRegistry() creates fresh storage
    debugLog('Cleaned up existing session for re-init');
  }

  initConfig = msg;

  // Azure OpenAI requires a tenant-specific endpoint URL.
  // The Pi SDK (via Vercel AI SDK) reads AZURE_OPENAI_BASE_URL from env.
  if (msg.piAuth?.provider === 'azure-openai-responses' && msg.baseUrl) {
    process.env.AZURE_OPENAI_BASE_URL = msg.baseUrl;
    debugLog(`Set AZURE_OPENAI_BASE_URL=${msg.baseUrl}`);
  }

  // Start callback server for call_llm (idempotent — skips if already running)
  await startCallbackServer();

  send({
    type: 'ready',
    sessionId: null,
    callbackPort,
  });
}

/**
 * Wait for any in-flight compaction to finish before sending a prompt or
 * starting another compaction. Prevents a race in the Pi SDK where concurrent
 * _runAutoCompaction calls crash on a shared AbortController
 * (see craft-agents-oss#464). Default timeout matches the RPC compact timeout
 * in PiAgent.requestCompact (300 s), since GPT compactions can legitimately
 * take 60–120 s.
 */
async function waitForCompaction(session: { isCompacting: boolean }, timeoutMs = 300_000): Promise<void> {
  if (!session.isCompacting) return;
  debugLog('Waiting for in-flight compaction to finish before prompt...');
  const start = Date.now();
  while (session.isCompacting) {
    if (Date.now() - start > timeoutMs) {
      debugLog(`Compaction wait timed out after ${Math.floor(timeoutMs / 1000)}s, proceeding anyway`);
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (Date.now() - start < timeoutMs) {
    debugLog('Compaction finished, proceeding with prompt');
  }
}

async function handlePrompt(msg: Extract<InboundMessage, { type: 'prompt' }>): Promise<void> {
  currentUserMessage = msg.message;
  const promptAttemptState = createPromptAttemptState();
  currentPromptAttemptState = promptAttemptState;
  let session: AgentSession | null = null;

  try {
    // If proxy tools changed since last session creation, dispose and recreate.
    // This avoids calling _buildRuntime() for dynamic tool updates — instead
    // we create a fresh session via continueRecent() with all tools known upfront.
    if (toolsChanged && piSession) {
      debugLog('Recreating session due to tool changes');
      if (unsubscribeEvents) {
        unsubscribeEvents();
        unsubscribeEvents = null;
      }
      piSession.dispose();
      piSession = null;
    }

    session = await ensureSession();

    // Pi does not auto-reload a caller-provided ResourceLoader. Refresh at the
    // prompt boundary so global Skill edits are visible without restarting the
    // session, while the loader remains restricted to explicit Storyflow roots.
    await session.resourceLoader.reload();

    currentToolsetHash = fingerprintTools(session.agent.state.tools);
    if (msg.systemPrompt) {
      const profile = systemPromptOverride?.set(
        msg.systemPrompt,
        session.resourceLoader.getSkills().skills,
        msg.dynamicSystemPrompt,
      );
      currentStablePrefixHash = profile?.stablePrefixHash ?? null;
    }

    // Wire up event handler
    if (unsubscribeEvents) {
      unsubscribeEvents();
    }
    unsubscribeEvents = session.subscribe(handleSessionEvent);

    // Wait for any in-flight auto-compaction to avoid race (craft-agents-oss#464)
    await waitForCompaction(session);

    // Fire prompt — use followUp when session is already streaming so the
    // message is queued instead of throwing "Agent is already processing".
    await session.prompt(msg.message, {
      images: msg.images && msg.images.length > 0 ? msg.images : undefined,
      streamingBehavior: 'followUp',
    });
  } catch (error) {
    let errorMsg = error instanceof Error ? error.message : String(error);

    // No wrapper-side overflow recovery here. The Pi SDK's _checkCompaction
    // already runs `_runAutoCompaction("overflow", true)` on overflow and
    // calls agent.continue() to retry once. Running our own session.compact()
    // in parallel raced against the SDK and is the documented cause of the
    // AbortController crash in `_runAutoCompaction` (see
    // plans/fix-pi-gpt-compaction.md). PiEventAdapter holds the Craft event
    // queue open across the SDK's recovery flow so the recovered turn
    // reaches the UI.

    if (session && shouldAutoRetryPromptFailure(errorMsg, promptAttemptState)) {
      promptAttemptState.retryAttempted = true;
      debugLog(`Retrying prompt once after transient stream interruption: ${errorMsg}`);
      try {
        await waitForCompaction(session);
        await retryPromptFromCurrentTranscript(session);
        return;
      } catch (retryError) {
        errorMsg = retryError instanceof Error ? retryError.message : String(retryError);
      }
    }

    debugLog(`Prompt failed: ${errorMsg}`);
    send({ type: 'error', message: errorMsg, code: 'prompt_error' });
    // Send synthetic agent_end so the main process event queue unblocks
    send({ type: 'event', event: { type: 'agent_end', messages: [], willRetry: false } });
  } finally {
    if (currentPromptAttemptState === promptAttemptState) {
      currentPromptAttemptState = null;
    }
  }
}

function handleRegisterTools(msg: Extract<InboundMessage, { type: 'register_tools' }>): void {
  // Merge: replace existing tools by name, add new ones
  const incoming = new Map(msg.tools.map(t => [t.name, t]));
  proxyToolDefs = [
    ...proxyToolDefs.filter(t => !incoming.has(t.name)),
    ...msg.tools,
  ].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  debugLog(`Registered ${msg.tools.length} proxy tools (total: ${proxyToolDefs.length}): ${msg.tools.map(t => t.name).join(', ')}`);

  // If session exists, mark for recreation on next prompt.
  // Don't dispose mid-generation — the flag is checked in handlePrompt().
  if (piSession) {
    toolsChanged = true;
    debugLog('Proxy tools changed — session will be recreated on next prompt');
  }
}

function handleToolExecuteResponse(msg: Extract<InboundMessage, { type: 'tool_execute_response' }>): void {
  const pending = pendingToolExecutions.get(msg.requestId);
  if (pending) {
    pendingToolExecutions.delete(msg.requestId);
    pending.resolve(msg.result);
  } else {
    debugLog(`No pending tool execution for requestId: ${msg.requestId}`);
  }
}

function handlePreToolUseResponse(msg: Extract<InboundMessage, { type: 'pre_tool_use_response' }>): void {
  const pending = pendingPreToolUse.get(msg.requestId);
  if (pending) {
    pendingPreToolUse.delete(msg.requestId);
    pending.resolve({ action: msg.action, input: msg.input, reason: msg.reason });
  } else {
    debugLog(`No pending pre_tool_use for requestId: ${msg.requestId}`);
  }
}

async function abortActiveSubagentSessions(): Promise<void> {
  await Promise.allSettled(
    [...activeSubagentSessions].map(session => session.abort()),
  );
}

async function handleAbort(): Promise<void> {
  const sessions = [
    ...(piSession ? [piSession] : []),
    ...activeSubagentSessions,
  ];
  const results = await Promise.allSettled(
    sessions.map(session => session.abort()),
  );
  for (const result of results) {
    if (result.status === 'rejected') {
      debugLog(
        `Abort failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      );
    }
  }

  // Reject all pending pre-tool-use requests
  for (const [, pending] of pendingPreToolUse) {
    pending.resolve({ action: 'block', reason: 'Aborted' });
  }
  pendingPreToolUse.clear();
}

async function handleMiniCompletion(msg: Extract<InboundMessage, { type: 'mini_completion' }>): Promise<void> {
  // Call queryLlm directly (not runMiniCompletion) so auth errors propagate
  // as 'error' messages instead of being swallowed and returned as null.
  // runMiniCompletion is kept for the summarize callback where null is acceptable.
  try {
    const result = await queryLlm({ prompt: msg.prompt });
    send({ type: 'mini_completion_result', id: msg.id, text: result.text || null });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[handleMiniCompletion] Error: ${errorMsg}`);
    send({ type: 'error', message: errorMsg, code: 'mini_completion_error' });
  }
}

// INVARIANT: the full LLMQueryRequest shape must pass through this RPC unchanged.
// Adding a field to LLMQueryRequest? Nothing to do here — we pass `msg.request`
// to queryLlm() verbatim. But verify queryLlm() actually honors the new field;
// request-propagation + request-honoring are independent (see #596).
async function handleLlmQuery(msg: Extract<InboundMessage, { type: 'llm_query' }>): Promise<void> {
  try {
    const result = await queryLlm(msg.request);
    send({ type: 'llm_query_result', id: msg.id, result });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[handleLlmQuery] Error: ${errorMsg}`);
    // Dual-emit: the generic `error` channel drives main-process OAuth
    // auth-refresh detection (centralized in PiAgent), while the targeted
    // `llm_query_result` rejects the pending promise for this specific call.
    send({ type: 'error', message: errorMsg, code: 'llm_query_error' });
    send({ type: 'llm_query_result', id: msg.id, result: null, errorMessage: errorMsg, errorCode: 'llm_query_error' });
  }
}

async function handleEnsureSessionReady(msg: Extract<InboundMessage, { type: 'ensure_session_ready' }>): Promise<void> {
  const session = await ensureSession();
  send({
    type: 'ensure_session_ready_result',
    id: msg.id,
    sessionId: session.sessionId || null,
  });
}

async function handleCompact(msg: Extract<InboundMessage, { type: 'compact' }>): Promise<void> {
  try {
    const session = await ensureSession();
    // Serialize manual /compact behind any in-flight auto-compaction. Public
    // session.compact() calls agent.abort() and uses its own controller; if
    // it runs while _runAutoCompaction is suspended, agent state churns and
    // the SDK's race surface widens. Wait for the auto-compaction to drain
    // before starting a manual one. waitForCompaction has its own timeout
    // fallback so we don't deadlock on a stuck subprocess.
    await waitForCompaction(session);
    const result = await session.compact(msg.customInstructions);
    send({
      type: 'compact_result',
      id: msg.id,
      success: true,
      result: {
        summary: result.summary,
        firstKeptEntryId: result.firstKeptEntryId,
        tokensBefore: result.tokensBefore,
      },
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[compact] Failed: ${errorMsg}`);
    send({
      type: 'compact_result',
      id: msg.id,
      success: false,
      errorMessage: errorMsg,
    });
  }
}

async function handleRewindUserMessage(
  msg: Extract<InboundMessage, { type: 'rewind_user_message' }>,
): Promise<void> {
  try {
    const session = await ensureSession();

    // Pi navigateTree refuses mid-stream tree edits. Abort any active turn first.
    if (session.isStreaming) {
      await session.abort();
    }

    const branch = session.sessionManager.getBranch();
    const userEntries = branch.filter(
      (entry) => entry.type === 'message' && entry.message?.role === 'user',
    );
    const target = userEntries[msg.userOrdinal];
    if (!target) {
      throw new Error(
        `User message ordinal ${msg.userOrdinal} not found on active branch (${userEntries.length} user messages)`,
      );
    }

    // Pi-native in-place rewind: same session file, leaf → parent of user message.
    const result = await session.navigateTree(target.id, { summarize: false });
    if (result.cancelled) {
      send({
        type: 'rewind_user_message_result',
        id: msg.id,
        success: false,
        errorMessage: 'Rewind cancelled',
      });
      return;
    }

    send({
      type: 'rewind_user_message_result',
      id: msg.id,
      success: true,
      editorText: result.editorText,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[rewind_user_message] Failed: ${errorMsg}`);
    send({
      type: 'rewind_user_message_result',
      id: msg.id,
      success: false,
      errorMessage: errorMsg,
    });
  }
}

async function handleSetAutoCompaction(msg: Extract<InboundMessage, { type: 'set_auto_compaction' }>): Promise<void> {
  try {
    const session = await ensureSession();
    session.setAutoCompactionEnabled(msg.enabled);
    send({
      type: 'set_auto_compaction_result',
      id: msg.id,
      success: true,
      enabled: session.autoCompactionEnabled,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[set_auto_compaction] Failed: ${errorMsg}`);
    send({
      type: 'set_auto_compaction_result',
      id: msg.id,
      success: false,
      enabled: msg.enabled,
      errorMessage: errorMsg,
    });
  }
}

async function handleUpdateRuntimeConfig(msg: RuntimeConfigUpdateMessage): Promise<void> {
  try {
    if (!initConfig) {
      throw new Error('Runtime config update received before init');
    }

    initConfig = {
      ...initConfig,
      model: msg.model,
      providerType: msg.providerType ?? initConfig.providerType,
      authType: msg.authType ?? initConfig.authType,
      baseUrl: msg.baseUrl,
      customEndpoint: msg.customEndpoint,
      customModels: msg.customModels,
    };

    if (piModelRegistry && initConfig.baseUrl?.trim() && initConfig.customEndpoint) {
      const modelEntries: CustomEndpointModelEntry[] = (initConfig.customModels?.length
        ? initConfig.customModels
        : [initConfig.model || 'default']
      ).map(normalizeCustomEndpointModelEntry);

      customEndpointModelIds = new Set();
      customModelOverrides.clear();
      registerCustomEndpointModels(piModelRegistry, initConfig.customEndpoint.api, initConfig.baseUrl.trim(), modelEntries);
    }

    if (piSession && piModelRegistry) {
      let piModel = resolvePiModel(piModelRegistry, msg.model, initConfig.piAuth?.provider, shouldPreferCustomEndpoint());
      if (!piModel && initConfig.baseUrl?.trim() && initConfig.customEndpoint) {
        const bareId = stripPiPrefix(msg.model);
        registerCustomEndpointModels(piModelRegistry, initConfig.customEndpoint.api, initConfig.baseUrl.trim(), [{ id: bareId }]);
        piModel = piModelRegistry.find(getCustomEndpointProviderName(), bareId) ?? undefined;
        debugLog(`[runtime_config] Dynamically registered custom endpoint model: ${bareId}`);
      }

      if (!piModel) {
        throw new Error(`Could not resolve model after runtime update: ${msg.model}`);
      }

      await piSession.setModel(piModel);
      setInterceptorApiHints(piModel as { api?: string; provider?: string; baseUrl?: string });
      debugLog(`[runtime_config] Updated runtime config and active model: ${piModel.provider}/${piModel.id}`);
    } else {
      debugLog('[runtime_config] Stored update; no active session/model registry yet');
    }

    send({ type: 'update_runtime_config_result', id: msg.id, success: true, updated: true });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[runtime_config] Failed: ${errorMsg}`);
    send({ type: 'update_runtime_config_result', id: msg.id, success: false, updated: false, errorMessage: errorMsg });
  }
}

async function handleSetModel(msg: Extract<InboundMessage, { type: 'set_model' }>): Promise<void> {
  debugLog(`[set_model] Received: ${msg.model}`);
  if (!piSession || !piModelRegistry) {
    debugLog(`[set_model] No active session or model registry, ignoring`);
    return;
  }
  let piModel = resolvePiModel(piModelRegistry, msg.model, initConfig?.piAuth?.provider, shouldPreferCustomEndpoint());

  // For custom endpoints, dynamically register unknown models so mid-session switching works.
  // Uses registerCustomEndpointModels which accumulates into the existing model set
  // (registerProvider replaces, so we track all IDs and re-register the full set).
  if (!piModel && initConfig?.baseUrl?.trim() && initConfig?.customEndpoint) {
    const bareId = stripPiPrefix(msg.model);
    registerCustomEndpointModels(piModelRegistry, initConfig.customEndpoint.api, initConfig.baseUrl!.trim(), [{ id: bareId }]);
    piModel = piModelRegistry.find(getCustomEndpointProviderName(), bareId) ?? undefined;
    debugLog(`[set_model] Dynamically registered custom endpoint model: ${bareId}`);
  }

  if (!piModel) {
    debugLog(`[set_model] Could not resolve model: ${msg.model}`);
    setInterceptorApiHints(undefined);
    return;
  }
  try {
    await piSession.setModel(piModel);
    setInterceptorApiHints(piModel as { api?: string; provider?: string; baseUrl?: string });
    debugLog(`[set_model] Model changed to: ${msg.model} (resolved: ${piModel.provider}/${piModel.id})`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[set_model] Failed to set model: ${errorMsg}`);
  }
}

async function handleSetThinkingLevel(msg: Extract<InboundMessage, { type: 'set_thinking_level' }>): Promise<void> {
  debugLog(`[set_thinking_level] Received: ${msg.level}`);

  if (!piSession) {
    debugLog('[set_thinking_level] No active session, ignoring');
    return;
  }

  const piLevel = THINKING_TO_PI[msg.level as keyof typeof THINKING_TO_PI];
  if (!piLevel) {
    debugLog(`[set_thinking_level] No Pi mapping for level: ${msg.level}`);
    return;
  }

  try {
    piSession.setThinkingLevel(piLevel);
    debugLog(`[set_thinking_level] Thinking level changed to: ${msg.level} (mapped: ${piLevel})`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[set_thinking_level] Failed to set thinking level: ${errorMsg}`);
  }
}

function handleShutdown(): void {
  debugLog('Shutdown requested');

  void abortActiveSubagentSessions();

  // Unsubscribe events
  if (unsubscribeEvents) {
    unsubscribeEvents();
    unsubscribeEvents = null;
  }

  // Dispose session
  if (piSession) {
    piSession.dispose();
    piSession = null;
  }

  // Stop callback server
  stopCallbackServer();

  // Reject pending promises
  for (const [, pending] of pendingPreToolUse) {
    pending.resolve({ action: 'block', reason: 'Server shutting down' });
  }
  pendingPreToolUse.clear();

  for (const [, pending] of pendingToolExecutions) {
    pending.resolve({ content: 'Server shutting down', isError: true });
  }
  pendingToolExecutions.clear();

  process.exit(0);
}

// ============================================================
// Main JSONL Reader Loop
// ============================================================

async function processMessage(msg: InboundMessage): Promise<void> {
  switch (msg.type) {
    case 'init':
      await handleInit(msg);
      break;

    case 'prompt':
      await handlePrompt(msg);
      break;

    case 'register_tools':
      handleRegisterTools(msg);
      break;

    case 'tool_execute_response':
      handleToolExecuteResponse(msg);
      break;

    case 'pre_tool_use_response':
      handlePreToolUseResponse(msg);
      break;

    case 'abort':
      await handleAbort();
      break;

    case 'mini_completion':
      await handleMiniCompletion(msg);
      break;

    case 'llm_query':
      await handleLlmQuery(msg);
      break;

    case 'ensure_session_ready':
      await handleEnsureSessionReady(msg);
      break;

    case 'set_model':
      await handleSetModel(msg);
      break;

    case 'set_thinking_level':
      await handleSetThinkingLevel(msg);
      break;

    case 'compact':
      await handleCompact(msg);
      break;

    case 'set_auto_compaction':
      await handleSetAutoCompaction(msg);
      break;

    case 'rewind_user_message':
      await handleRewindUserMessage(msg);
      break;

    case 'update_runtime_config':
      await handleUpdateRuntimeConfig(msg);
      break;

    case 'steer':
      if (piSession) {
        debugLog(`Steering with: "${msg.message.slice(0, 100)}"`);
        await piSession.steer(msg.message);
      } else {
        debugLog('Steer ignored — no active session');
      }
      break;

    case 'token_update':
      if (moduleAuthStorage) {
        const { provider, credential } = msg.piAuth;
        // See ambient comment at the initial `authStorage.set` call — same shape reason.
        const credentialProviders = resolveRuntimeCredentialProviderNames(
          provider,
          !!initConfig?.baseUrl?.trim() && !!initConfig.customEndpoint,
        );
        for (const credentialProvider of credentialProviders) {
          moduleAuthStorage.set(credentialProvider, credential as unknown as AuthCredential);
        }
        if (initConfig) {
          initConfig.piAuth = msg.piAuth;
        }
        debugLog(`Updated ${credential.type} credential for provider(s): ${credentialProviders.join(', ')}`);
      } else {
        debugLog('token_update received but no authStorage initialized');
      }
      break;

    case 'shutdown':
      handleShutdown();
      break;

    default:
      debugLog(`Unknown message type: ${(msg as any).type}`);
  }
}

function main(): void {
  debugLog('Pi agent server starting');

  readJsonLines(process.stdin, (line) => {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line) as InboundMessage;
      processMessage(msg).catch((error) => {
        const errorMsg = error instanceof Error ? error.message : String(error);
        debugLog(`Error processing message: ${errorMsg}`);
        send({ type: 'error', message: errorMsg });
      });
    } catch (parseError) {
      debugLog(`Failed to parse JSONL: ${parseError}`);
    }
  }, () => {
    debugLog('stdin closed, shutting down');
    handleShutdown();
  });

  // Handle unexpected errors — process state is unreliable after these,
  // so we attempt to report and then exit immediately.
  // send() is wrapped in try/catch because stdout itself may be broken
  // (e.g. EFAULT from a closed pipe), and we must not let the error
  // report trigger another uncaughtException (which would loop).
  process.on('uncaughtException', (error) => {
    debugLog(`Uncaught exception: ${error.message}`);
    try {
      send({ type: 'error', message: `Uncaught exception: ${error.message}`, code: 'uncaught' });
    } catch {
      // stdout may be broken — swallow to avoid re-triggering
    }
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    debugLog(`Unhandled rejection: ${msg}`);
    try {
      send({ type: 'error', message: `Unhandled rejection: ${msg}`, code: 'unhandled_rejection' });
    } catch {
      // stdout may be broken — swallow to avoid re-triggering
    }
    process.exit(1);
  });
}

async function runSkillCatalogMode(cwd: string): Promise<void> {
  const agentDir = getAgentDir();
  const { resourceLoader } = await createProjectResourceLoader({ cwd, agentDir });
  const catalog = resourceLoader.getSkills();
  process.stdout.write(`${JSON.stringify(catalog)}\n`);
}

const skillCatalogArg = process.argv.indexOf('--skill-catalog');
if (skillCatalogArg >= 0) {
  const cwd = process.argv[skillCatalogArg + 1];
  if (!cwd) {
    console.error('Missing cwd after --skill-catalog');
    process.exit(2);
  }
  runSkillCatalogMode(cwd).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
} else {
  main();
}
