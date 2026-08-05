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

import { mkdirSync } from 'node:fs';

// Pi SDK
import {
  ModelRegistry as PiModelRegistry,
  getAgentDir,
} from '@earendil-works/pi-coding-agent';
import type {
  AgentSession,
  AgentSessionEvent,
} from '@earendil-works/pi-coding-agent';

// Pi AI types
import type {
  AssistantMessage,
} from '@earendil-works/pi-ai';

// Pre-register the Bedrock provider module so the Pi SDK doesn't attempt a
// dynamic import of "./amazon-bedrock.js" — which fails in the bundled output
// because bun collapses everything into a single file.
// pi-ai is deduped (single hoisted copy), so one registration covers both
// pi-ai and pi-agent-core module scopes.
import { setBedrockProviderModule } from '@earendil-works/pi-ai/api/bedrock-converse-stream.lazy';
import { bedrockProviderModule } from '@earendil-works/pi-ai/bedrock-provider';
setBedrockProviderModule(bedrockProviderModule);

// Direct source imports from shared (bundled by bun build)
import { getSessionPath } from '../../shared/src/sessions/storage.ts';
import { buildCallLlmRequest } from '../../shared/src/agent/llm-tool.ts';
import type { LLMQueryRequest, LLMQueryResult } from '../../shared/src/agent/llm-tool.ts';
import { readJsonLines } from '../../shared/src/utils/jsonl.ts';
import { THINKING_TO_PI } from '../../shared/src/agent/backend/pi/constants.ts';
import type {
  ConversationRewindResult,
} from '../../shared/src/agent/backend/types.ts';
import type {
  PiInboundMessage,
  PiOutboundMessage,
  PiProxyToolDefinition,
} from '../../shared/src/agent/backend/pi/protocol.ts';
import {
  createSkillCatalogResourceLoader,
} from './project-resource-loader.ts';
import { createSystemPromptOverride } from './system-prompt-override.ts';
import { fingerprintTools } from './prompt-cache-profile.ts';
import {
  PRODUCT_REWIND_BOUNDARY_TYPE,
  createProductRewindBoundary,
  findProductRewindBoundary,
} from './product-rewind.ts';
import { queryLlmWithEphemeralPiSession } from './ephemeral-llm-query.ts';
import { PiModelRuntime } from './pi-model-runtime.ts';
import { createPrimaryPiSession } from './primary-session.ts';
import { createPiToolRuntime } from './pi-tool-runtime.ts';
import { installNetworkProxy } from './network-proxy.ts';
import {
  sanitizeAssistantMessageForResume,
  type PiSessionSanitizeResult,
} from './pi-session-sanitizer.ts';
import {
  createPromptAttemptState,
  recordPromptAttemptEvent,
  shouldSuppressRetryablePromptFailure,
  type PromptAttemptState,
} from './prompt-retry.ts';

installNetworkProxy();

// ============================================================
// State
// ============================================================

let piSession: AgentSession | null = null;
let piModelRegistry: PiModelRegistry | null = null;
let unsubscribeEvents: (() => void) | null = null;
let systemPromptOverride: ReturnType<typeof createSystemPromptOverride> | null = null;

// Init config (set on 'init' message)
let initConfig: Extract<PiInboundMessage, { type: 'init' }> | null = null;

// Mutable state
let currentUserMessage = '';
let currentPromptAttemptState: PromptAttemptState | null = null;
let pendingProductRewindBoundary: Extract<PiInboundMessage, { type: 'prompt' }>['rewindBoundary'] | null = null;
let currentStablePrefixHash: string | null = null;
let currentToolsetHash: string | null = null;

// Pending promises for async handshakes
const pendingPreToolUse = new Map<string, { resolve: (response: { action: string; input?: Record<string, unknown>; reason?: string }) => void }>();
const pendingToolExecutions = new Map<string, { resolve: (result: { content: string; isError: boolean }) => void }>();
const pendingConversationRewinds = new Map<string, {
  resolve: (result: ConversationRewindResult) => void;
  reject: (error: Error) => void;
}>();
const activeSubagentSessions = new Set<AgentSession>();

// Proxy tool definitions from main process
let proxyToolDefs: PiProxyToolDefinition[] = [];

// Flag: proxy tools changed since last session creation — session needs recreation
let toolsChanged = false;

// ============================================================
// JSONL I/O
// ============================================================

function send(msg: PiOutboundMessage): void {
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

// ============================================================
// Pi Session Management
// ============================================================

const modelRuntime = new PiModelRuntime(() => initConfig, send, debugLog);

async function ensureSession(): Promise<AgentSession> {
  if (piSession) return piSession;
  if (!initConfig) throw new Error('Cannot create session: init not received');

  const cwd = modelRuntime.resolvedCwd();
  const agentDir = initConfig.agentDir || getAgentDir();
  mkdirSync(agentDir, { recursive: true });
  const piThinkingLevel = THINKING_TO_PI[
    initConfig.thinkingLevel as keyof typeof THINKING_TO_PI
  ];
  const { authStorage, modelRegistry } = modelRuntime.createAuthenticatedRegistry();
  piModelRegistry = modelRegistry;

  const created = await createPrimaryPiSession({
    config: initConfig,
    cwd,
    agentDir,
    authStorage,
    modelRegistry,
    thinkingLevel: piThinkingLevel,
    activeSubagentSessions,
    buildProxyTools,
    prepareToolDefinitions,
    createSessionToolHooks,
    getCurrentUserMessage: () => currentUserMessage,
    requestHostTool,
    executeSessionRewind,
    handleShutdown,
    send,
    debug: debugLog,
  });
  piSession = created.session;
  systemPromptOverride = created.systemPromptOverride;
  toolsChanged = false;
  return piSession;
}


const {
  createSessionToolHooks,
  prepareToolDefinitions,
  buildProxyTools,
  requestHostTool,
  executeSessionRewind,
} = createPiToolRuntime({
  getConfig: () => initConfig,
  getProxyToolDefs: () => proxyToolDefs,
  pendingPreToolUse,
  pendingToolExecutions,
  pendingConversationRewinds,
  send,
  debug: debugLog,
  runMiniCompletion,
  preExecuteCallLlm,
});

// ============================================================
// LLM Query (ephemeral session for call_llm + mini completions)
// ============================================================

async function queryLlm(request: LLMQueryRequest): Promise<LLMQueryResult> {
  if (!initConfig) throw new Error('Cannot run queryLlm: init not received');
  const { authStorage, modelRegistry } = modelRuntime.createAuthenticatedRegistry();
  return queryLlmWithEphemeralPiSession(request, {
    config: initConfig,
    cwd: modelRuntime.resolvedCwd(),
    authStorage,
    modelRegistry,
    preferCustomEndpoint: modelRuntime.prefersCustomEndpoint(),
    debug: debugLog,
  });
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

function handleSessionEvent(event: AgentSessionEvent): void {
  const promptAttemptState = currentPromptAttemptState;
  if (promptAttemptState) {
    recordPromptAttemptEvent(promptAttemptState, event as unknown as Record<string, unknown>);

    const assistantErrorMessage = getAssistantErrorMessage(event);
    if (assistantErrorMessage && shouldSuppressRetryablePromptFailure(assistantErrorMessage, promptAttemptState)) {
      debugLog(`Suppressing retryable stream failure before automatic retry: ${assistantErrorMessage}`);
      return;
    }

  }

  if (event.type === 'message_start' && event.message.role === 'assistant' && pendingProductRewindBoundary && piSession) {
    const boundary = createProductRewindBoundary(
      piSession.sessionManager.getBranch(),
      pendingProductRewindBoundary,
    );
    if (boundary) {
      piSession.sessionManager.appendCustomEntry(PRODUCT_REWIND_BOUNDARY_TYPE, boundary);
      pendingProductRewindBoundary = null;
    }
  }

  let forwardedEvent: Extract<PiOutboundMessage, { type: 'event' }>['event'] = event;

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

  // Forward all events to main process
  send({ type: 'event', event: forwardedEvent });
}

// ============================================================
// Command Handlers
// ============================================================

async function handleInit(msg: Extract<PiInboundMessage, { type: 'init' }>): Promise<void> {
  await abortActiveSubagentSessions();

  // Clean up any existing session from a previous init
  if (piSession) {
    if (unsubscribeEvents) {
      unsubscribeEvents();
      unsubscribeEvents = null;
    }
    piSession.dispose();
    piSession = null;
    debugLog('Cleaned up existing session for re-init');
  }

  modelRuntime.resetAuth();
  initConfig = msg;

  // Azure OpenAI requires a tenant-specific endpoint URL.
  // The Pi SDK (via Vercel AI SDK) reads AZURE_OPENAI_BASE_URL from env.
  if (msg.piAuth?.provider === 'azure-openai-responses' && msg.baseUrl) {
    process.env.AZURE_OPENAI_BASE_URL = msg.baseUrl;
    debugLog(`Set AZURE_OPENAI_BASE_URL=${msg.baseUrl}`);
  }

  send({
    type: 'ready',
    sessionId: null,
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

async function handlePrompt(msg: Extract<PiInboundMessage, { type: 'prompt' }>): Promise<void> {
  currentUserMessage = msg.message;
  const promptAttemptState = createPromptAttemptState();
  currentPromptAttemptState = promptAttemptState;
  pendingProductRewindBoundary = msg.rewindBoundary ?? null;
  let sawAgentSettled = false;

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

    const session = await ensureSession();

    // Keep Pi's ResourceLoader and ExtensionRunner on the same generation.
    // Reloading the loader alone leaves slash commands bound to stale resources.
    await session.reload();
    debugLog(
      `Active Pi Extension commands: ${session.extensionRunner.getRegisteredCommands().map(command => command.invocationName).join(', ') || '(none)'}`,
    );

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
    unsubscribeEvents = session.subscribe((event) => {
      const forward = () => {
        if (event.type === 'agent_settled') sawAgentSettled = true;
        handleSessionEvent(event);
      };

      // Pi persists assistant messages immediately after notifying subscribers.
      // Defer this one event so sdkTurnAnchor names the assistant entry, not its parent.
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        queueMicrotask(forward);
      } else {
        forward();
      }
    });

    // Wait for any in-flight auto-compaction to avoid race (craft-agents-oss#464)
    await waitForCompaction(session);

    // Fire prompt — use followUp when session is already streaming so the
    // message is queued instead of throwing "Agent is already processing".
    await session.prompt(msg.message, {
      images: msg.images && msg.images.length > 0 ? msg.images : undefined,
      streamingBehavior: 'followUp',
    });

    // Extension commands can finish without starting an agent turn. Mirror that
    // completion into the existing stream so the host does not wait forever.
    if (!sawAgentSettled && session.isIdle) {
      send({ type: 'event', event: { type: 'agent_settled' } });
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // No wrapper-side overflow recovery here. The Pi SDK's _checkCompaction
    // already runs `_runAutoCompaction("overflow", true)` on overflow and
    // calls agent.continue() to retry once. Running our own session.compact()
    // in parallel raced against the SDK and is the documented cause of the
    // AbortController crash in `_runAutoCompaction` (see
    // plans/fix-pi-gpt-compaction.md). PiEventAdapter holds the Craft event
    // queue open across the SDK's recovery flow so the recovered turn
    // reaches the UI.

    debugLog(`Prompt failed: ${errorMsg}`);
    send({ type: 'error', message: errorMsg, code: 'prompt_error' });
    // Prompt preflight/Extension failures may not start a Pi run.
    if (!sawAgentSettled) {
      send({ type: 'event', event: { type: 'agent_settled' } });
    }
  } finally {
    if (currentPromptAttemptState === promptAttemptState) {
      currentPromptAttemptState = null;
    }
    pendingProductRewindBoundary = null;
  }
}

function handleRegisterTools(msg: Extract<PiInboundMessage, { type: 'register_tools' }>): void {
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

function handleToolExecuteResponse(msg: Extract<PiInboundMessage, { type: 'tool_execute_response' }>): void {
  const pending = pendingToolExecutions.get(msg.requestId);
  if (pending) {
    pendingToolExecutions.delete(msg.requestId);
    pending.resolve(msg.result);
  } else {
    debugLog(`No pending tool execution for requestId: ${msg.requestId}`);
  }
}

function handlePreToolUseResponse(msg: Extract<PiInboundMessage, { type: 'pre_tool_use_response' }>): void {
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

// INVARIANT: the full LLMQueryRequest shape must pass through this RPC unchanged.
// Adding a field to LLMQueryRequest? Nothing to do here — we pass `msg.request`
// to queryLlm() verbatim. But verify queryLlm() actually honors the new field;
// request-propagation + request-honoring are independent (see #596).
async function handleLlmQuery(msg: Extract<PiInboundMessage, { type: 'llm_query' }>): Promise<void> {
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

async function handleEnsureSessionReady(msg: Extract<PiInboundMessage, { type: 'ensure_session_ready' }>): Promise<void> {
  const session = await ensureSession();
  send({
    type: 'ensure_session_ready_result',
    id: msg.id,
    sessionId: session.sessionId || null,
  });
}

async function handleCompact(msg: Extract<PiInboundMessage, { type: 'compact' }>): Promise<void> {
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
  msg: Extract<PiInboundMessage, { type: 'rewind_user_message' }>,
): Promise<void> {
  try {
    const session = await ensureSession();

    const mappedBoundary = findProductRewindBoundary(
      session.sessionManager.getEntries(),
      { visibleUserMessageId: msg.visibleUserMessageId },
    );
    if (!mappedBoundary) {
      throw new Error(
        'This message predates safe Storyflow rewind mapping and cannot be restored.',
      );
    }
    const target = session.sessionManager.getEntry(mappedBoundary.userEntryId);
    if (!target || target.type !== 'message' || target.message.role !== 'user') {
      throw new Error('Mapped rewind target is not a Pi user message');
    }
    if (!session.sessionManager.getBranch().some(entry => entry.id === target.id)) {
      throw new Error('Mapped rewind target is not on the active Pi branch');
    }

    const projection = {
      retainThroughMessageId: mappedBoundary.retainThroughMessageId,
      ...(mappedBoundary.draftText !== undefined ? { draftText: mappedBoundary.draftText } : {}),
    };
    const result = await executeSessionRewind(
      session,
      target.id,
      { summarize: false },
      projection,
    );
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

async function handleUpdateRuntimeConfig(
  msg: Extract<PiInboundMessage, { type: 'update_runtime_config' }>,
): Promise<void> {
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
      modelRuntime.refreshCustomEndpointModels(piModelRegistry);
    }

    if (piSession && piModelRegistry) {
      const piModel = modelRuntime.resolveModel(piModelRegistry, msg.model, 'runtime_config');

      if (!piModel) {
        throw new Error(`Could not resolve model after runtime update: ${msg.model}`);
      }

      await piSession.setModel(piModel);
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

async function handleSetModel(msg: Extract<PiInboundMessage, { type: 'set_model' }>): Promise<void> {
  debugLog(`[set_model] Received: ${msg.model}`);
  if (!piSession || !piModelRegistry) {
    debugLog(`[set_model] No active session or model registry, ignoring`);
    return;
  }
  const piModel = modelRuntime.resolveModel(piModelRegistry, msg.model, 'set_model');

  if (!piModel) {
    debugLog(`[set_model] Could not resolve model: ${msg.model}`);
    return;
  }
  try {
    await piSession.setModel(piModel);
    debugLog(`[set_model] Model changed to: ${msg.model} (resolved: ${piModel.provider}/${piModel.id})`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[set_model] Failed to set model: ${errorMsg}`);
  }
}

async function handleSetThinkingLevel(msg: Extract<PiInboundMessage, { type: 'set_thinking_level' }>): Promise<void> {
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

  // Reject pending promises
  for (const [, pending] of pendingPreToolUse) {
    pending.resolve({ action: 'block', reason: 'Server shutting down' });
  }
  pendingPreToolUse.clear();

  for (const [, pending] of pendingToolExecutions) {
    pending.resolve({ content: 'Server shutting down', isError: true });
  }
  pendingToolExecutions.clear();

  for (const [, pending] of pendingConversationRewinds) {
    pending.reject(new Error('Server shutting down'));
  }
  pendingConversationRewinds.clear();

  process.exit(0);
}

// ============================================================
// Main JSONL Reader Loop
// ============================================================

async function processMessage(msg: PiInboundMessage): Promise<void> {
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

    case 'conversation_rewind_response': {
      const pending = pendingConversationRewinds.get(msg.requestId);
      if (!pending) break;
      pendingConversationRewinds.delete(msg.requestId);
      if (!msg.success) {
        pending.reject(new Error(msg.errorMessage || 'Product transcript rewind failed'));
        break;
      }
      if (!msg.result) {
        pending.reject(new Error('Product transcript rewind returned no result'));
        break;
      }
      pending.resolve(msg.result);
      break;
    }

    case 'pre_tool_use_response':
      handlePreToolUseResponse(msg);
      break;

    case 'abort':
      await handleAbort();
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

    case 'token_update': {
      try {
        modelRuntime.updateCredential(msg.piAuth);
        send({ type: 'token_update_result', id: msg.id, success: true });
      } catch (error) {
        send({
          type: 'token_update_result',
          id: msg.id,
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
      break;
    }

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
      const msg = JSON.parse(line) as PiInboundMessage;
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
  const resourceLoader = await createSkillCatalogResourceLoader({ cwd, agentDir });
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
