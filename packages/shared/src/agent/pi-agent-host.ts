// input: Backend config, source/tool managers, permissions, and session messages
// output: Storyflow Product Host behavior projected into the Pi runtime
// pos: Pi-specific host policy layer beneath PiAgent, not a runtime abstraction

import type { AgentEvent } from '@craft-agent/core/types';
import type { FileAttachment } from '../utils/files.ts';
import { expandPath } from '../utils/paths.ts';
import { buildBranchSeedContext, buildTransferredSessionContext } from './conversation-summary.ts';
import type { ThinkingLevel } from './thinking-levels.ts';
import { DEFAULT_THINKING_LEVEL, normalizeThinkingLevel } from './thinking-levels.ts';
import type { PermissionMode } from './mode-manager.ts';
import type { LoadedSource } from '../sources/types.ts';
import { buildCallLlmRequest, type LLMQueryRequest, type LLMQueryResult } from './llm-tool.ts';
import { getLlmConnections, getDefaultLlmConnection } from '../config/storage.ts';
import { loadAllSources } from '../sources/storage.ts';
import type { ApiServerConfig } from '../mcp/mcp-pool.ts';

import type {
  ChatOptions,
  PermissionCallback,
  PlanCallback,
  AuthCallback,
  SourceActivationCallback,
  SdkMcpServerConfig,
  BackendConfig,
  PostInitResult,
  BridgeUpdateContext,
} from './backend/types.ts';
import { AbortReason } from './backend/types.ts';
import type { Workspace } from '../config/storage.ts';

// Core modules
import { PermissionManager } from './core/permission-manager.ts';
import { SourceManager } from './core/source-manager.ts';
import { PromptBuilder } from './core/prompt-builder.ts';
import { PrerequisiteManager } from './core/prerequisite-manager.ts';

// Automation system for agent events
import type { AutomationSystem } from '../automations/automation-system.ts';
import type { AgentAutomationInput, AgentEvent as AutomationAgentEvent } from '../automations/types.ts';
import { getSessionPlansPath, getSessionDataPath, getSessionPath } from '../sessions/storage.ts';
import { getMiniAgentSystemPrompt } from '../prompts/system.ts';
import { buildTitlePrompt, buildRegenerateTitlePrompt, validateTitle } from '../utils/title-generator.ts';
import { getCurrentLanguageName } from '../i18n/language-policy.ts';
import { resolveSystemPromptPresetForWorkingDirectory } from './system-prompt-preset.ts';
import { preparePiSkillCommand } from './pi-skill-command.ts';
import {
  MINI_AGENT_MCP_KEYS,
  MINI_AGENT_TOOLS,
  type MiniAgentConfig,
  type SpawnSessionHelpResult,
  type SpawnSessionRequest,
  type SpawnSessionResult,
} from './pi-agent-host-types.ts';

// ============================================================
// Pi Agent Product Host
// ============================================================

/**
 * Storyflow Product Host behavior used by the single Pi runtime.
 *
 * Provides:
 * - Common state management (model, thinking, workspace, session)
 * - Core module delegation (PermissionManager, SourceManager, etc.)
 * - Callback declarations for UI integration
 *
 * Subclasses must implement:
 * - backendName: Display name for error messages ('Claude', 'Codex', etc.)
 * - chat(): Provider-specific agentic loop
 * - abort(): Provider-specific abort handling
 * - capabilities(): Provider-specific capabilities
 * - respondToPermission(): Provider-specific permission resolution
 * - destroy(): Provider-specific cleanup
 * - runMiniCompletion(): Simple text completion using backend's auth
 */
export abstract class PiAgentHost {
  // ============================================================
  // Backend Identity
  // ============================================================
  protected abstract backendName: string;

  /** Whether this backend supports session branching. Subclasses can override. */
  protected _supportsBranching = true;
  get supportsBranching(): boolean { return this._supportsBranching; }

  // ============================================================
  // Configuration (protected for subclass access)
  // ============================================================
  protected config: BackendConfig;
  protected workingDirectory: string;
  protected _sessionId: string;

  // ============================================================
  // Model Configuration (protected for subclass access)
  // ============================================================
  protected _model: string;
  protected _thinkingLevel: ThinkingLevel;

  // ============================================================
  // Core Modules (protected for subclass access)
  // ============================================================
  protected permissionManager: PermissionManager;
  protected sourceManager: SourceManager;
  protected promptBuilder: PromptBuilder;
  protected prerequisiteManager: PrerequisiteManager;
  protected automationSystem?: AutomationSystem;

  // ============================================================
  // Additional State (protected for subclass access)
  // ============================================================
  protected temporaryClarifications: string | null = null;

  protected _currentUserIteration: number | undefined;

  protected getCurrentUserIteration(): number | undefined {
    return this._currentUserIteration;
  }

  // ============================================================
  // Callbacks (public for facade wiring)
  // ============================================================
  onPermissionRequest: PermissionCallback | null = null;
  onPlanSubmitted: PlanCallback | null = null;
  onAuthRequest: AuthCallback | null = null;
  onPermissionModeChange: ((mode: PermissionMode) => void) | null = null;
  onDebug: ((message: string) => void) | null = null;
  onSourceActivationRequest: SourceActivationCallback | null = null;
  onBackendAuthRequired: ((reason: string) => void) | null = null;
  onSpawnSession: ((request: SpawnSessionRequest) => Promise<SpawnSessionResult>) | null = null;

  // ============================================================
  // Constructor
  // ============================================================

  constructor(config: BackendConfig, defaultModel: string) {
    this.config = config;
    // Use session's workingDirectory if set (user-changeable), fallback to workspace root
    this.workingDirectory = config.session?.workingDirectory ?? config.workspace.rootPath ?? process.cwd();
    this.config.systemPromptPreset ??= resolveSystemPromptPresetForWorkingDirectory(config.session?.workingDirectory);
    this._sessionId = config.session?.id || `agent-${Date.now()}`;
    this._model = config.model || defaultModel;
    this._thinkingLevel = normalizeThinkingLevel(config.thinkingLevel) ?? DEFAULT_THINKING_LEVEL;

    // Initialize core modules
    // PermissionManager: handles permission evaluation, mode management, and command whitelisting
    this.permissionManager = new PermissionManager({
      workspaceId: config.workspace.id,
      sessionId: this._sessionId,
      workingDirectory: this.workingDirectory,
      plansFolderPath: getSessionPlansPath(config.workspace.rootPath, this._sessionId),
      dataFolderPath: getSessionDataPath(config.workspace.rootPath, this._sessionId),
    });

    // SourceManager: tracks active/inactive sources and formats state for context injection
    this.sourceManager = new SourceManager({
      onDebug: (msg) => this.debug(msg),
    });

    // PromptBuilder: builds context blocks for user messages
    this.promptBuilder = new PromptBuilder({
      workspace: config.workspace,
      session: config.session,
      debugMode: config.debugMode,
      systemPromptPreset: config.systemPromptPreset,
      isHeadless: config.isHeadless,
    });

    // PrerequisiteManager: blocks source tool calls until guide.md is read
    this.prerequisiteManager = new PrerequisiteManager({
      workspaceRootPath: config.workspace.rootPath,
      onDebug: (msg) => this.debug(msg),
    });

    // AutomationSystem: workspace-level automations from automations.json
    this.automationSystem = config.automationSystem;
  }

  // ============================================================
  // Debug Logging (protected for subclass override)
  // ============================================================

  /**
   * Log a debug message. Override in subclass to add prefix.
   */
  protected debug(message: string): void {
    this.onDebug?.(message);
  }

  /**
   * Fire an automation agent event (from automations.json) via AutomationSystem.
   * Catches all errors — automations must never break the agent flow.
   * @param signal - Optional AbortSignal for cancelling automation execution on abort
   */
  protected async emitAutomationEvent(event: AutomationAgentEvent, input: AgentAutomationInput, signal?: AbortSignal): Promise<void> {
    try {
      await this.automationSystem?.executeAgentEvent(event, input, signal);
    } catch (err) {
      this.debug(`Automation event ${event} failed: ${err}`);
    }
  }

  // ============================================================
  // Model & Thinking Configuration
  // ============================================================

  getModel(): string {
    return this._model;
  }

  setModel(model: string): void {
    this._model = model;
  }

  getThinkingLevel(): ThinkingLevel {
    return this._thinkingLevel;
  }

  setThinkingLevel(level: ThinkingLevel): void {
    this._thinkingLevel = level;
    this.debug(`Thinking level set to: ${level}`);
  }

  // ============================================================
  // Permission Mode (delegated to PermissionManager)
  // ============================================================

  getPermissionMode(): PermissionMode {
    return this.permissionManager.getPermissionMode();
  }

  setPermissionMode(mode: PermissionMode): void {
    this.permissionManager.setPermissionMode(mode);
    this.onPermissionModeChange?.(mode);
  }

  cyclePermissionMode(): PermissionMode {
    const newMode = this.permissionManager.cyclePermissionMode();
    this.onPermissionModeChange?.(newMode);
    return newMode;
  }

  /**
   * Check if currently in safe mode (read-only exploration).
   */
  isInSafeMode(): boolean {
    return this.permissionManager.getPermissionMode() === 'safe';
  }

  // ============================================================
  // Workspace & Session
  // ============================================================

  getWorkspace(): Workspace {
    return this.config.workspace;
  }

  setWorkspace(workspace: Workspace): void {
    this.config.workspace = workspace;
    // Subclasses should clear session-specific state
  }

  getSessionId(): string | null {
    return this._sessionId;
  }

  setSessionId(sessionId: string | null): void {
    this._sessionId = sessionId || `agent-${Date.now()}`;
  }

  /**
   * Clear conversation history and start fresh.
   * Subclasses should override to clear provider-specific state.
   */
  clearHistory(): void {
    this.prerequisiteManager.resetReadState();
    this.debug('History cleared');
  }

  /**
   * Reset prerequisite read state (e.g., on context compaction).
   * After compaction the LLM no longer has guide content in context,
   * so it must re-read before using source tools.
   * Also resets seen sources so guide paths re-appear in source introductions.
   */
  resetPrerequisiteState(): void {
    this.prerequisiteManager.resetReadState();
    this.sourceManager.resetSeenSources();
  }

  /**
   * Update the working directory.
   * Also updates PermissionManager and persists to session config.
   */
  updateWorkingDirectory(path: string): void {
    this.workingDirectory = path;
    // Persist to session config.
    if (this.config.session) {
      this.config.session.workingDirectory = path;
    }
    this.permissionManager.updateWorkingDirectory(path);
    this.debug(`Working directory updated: ${path}`);
  }

  /**
   * Update the SDK cwd (used for transcript storage location).
   *
   * This should only be called when it's safe to update - i.e., before any
   * SDK interaction has occurred. The SessionManager checks this condition
   * before calling this method.
   *
   * This updates the session config so the agent uses the new path for
   * SDK operations going forward.
   */
  updateSdkCwd(path: string): void {
    if (this.config.session) {
      this.config.session.sdkCwd = path;
    }
    this.debug(`SDK cwd updated: ${path}`);
  }

  // ============================================================
  // Source Management (delegated to SourceManager)
  // ============================================================

  /**
   * Set the MCP server configurations for sources.
   * Called by facade when sources are activated/deactivated.
   *
   * Subclasses may override to handle provider-specific MCP setup.
   */
  async setSourceServers(
    mcpServers: Record<string, SdkMcpServerConfig>,
    apiServers: Record<string, unknown>,
    intendedSlugs?: string[]
  ): Promise<void> {
    // Update SourceManager state (common tracking)
    this.sourceManager.updateActiveState(
      Object.keys(mcpServers),
      Object.keys(apiServers),
      intendedSlugs
    );

    // Sync the centralized MCP client pool (if available)
    // Both MCP sources and API sources are routed through the pool.
    if (this.config.mcpPool) {
      try {
        await this.config.mcpPool.sync(mcpServers, apiServers as Record<string, ApiServerConfig>);
      } catch (err) {
        this.debug(`Failed to sync MCP pool: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  getActiveSourceSlugs(): string[] {
    return Array.from(this.sourceManager.getIntendedSlugs());
  }

  getAllSources(): LoadedSource[] {
    return this.sourceManager.getAllSources();
  }

  /**
   * Set all sources (for context injection).
   * Uses SourceManager for state tracking.
   */
  setAllSources(sources: LoadedSource[]): void {
    this.sourceManager.setAllSources(sources);
  }

  /**
   * Mark a source as unseen (will show introduction text again).
   */
  markSourceUnseen(sourceSlug: string): void {
    this.sourceManager.markSourceUnseen(sourceSlug);
  }

  /**
   * Check if a source server is currently active.
   */
  isSourceServerActive(serverName: string): boolean {
    return this.sourceManager.isSourceActive(serverName);
  }

  /**
   * Get the set of active source server names.
   */
  getActiveSourceServerNames(): Set<string> {
    return new Set(this.sourceManager.getActiveSlugs());
  }

  /**
   * Set temporary clarifications for context injection.
   * These are injected into prompts but not yet persisted.
   */
  setTemporaryClarifications(text: string | null): void {
    this.temporaryClarifications = text;
  }

  // ============================================================
  // Manager Accessors (for advanced queries)
  // ============================================================

  /**
   * Get SourceManager for advanced source state queries.
   */
  getSourceManager(): SourceManager {
    return this.sourceManager;
  }

  /**
   * Get PermissionManager for advanced permission queries.
   */
  getPermissionManager(): PermissionManager {
    return this.permissionManager;
  }

  /**
   * Get PromptBuilder for context building.
   */
  getPromptBuilder(): PromptBuilder {
    return this.promptBuilder;
  }

  // ============================================================
  // Mini Agent Mode (centralized for all backends)
  // ============================================================

  /**
   * Check if running in mini agent mode.
   * Centralized detection used by all backends.
   */
  isMiniAgent(): boolean {
    return this.config.systemPromptPreset === 'mini';
  }

  /**
   * Get the mini-agent configuration applied by PiAgent.
   */
  getMiniAgentConfig(): MiniAgentConfig {
    const enabled = this.isMiniAgent();
    return {
      enabled,
      tools: enabled ? MINI_AGENT_TOOLS : [],
      mcpServerKeys: enabled ? MINI_AGENT_MCP_KEYS : [],
      minimizeThinking: enabled,
    };
  }

  /**
   * Get the mini agent system prompt.
   * Shared across backends for consistency.
   * Uses workspace root path for config file locations.
   */
  getMiniSystemPrompt(): string {
    return getMiniAgentSystemPrompt(this.config.workspace.rootPath);
  }

  /**
   * Filter MCP servers for mini agent mode.
   * Only includes servers whose keys are in the allowed list.
   *
   * @param servers - Full set of MCP servers
   * @param allowedKeys - Keys to include (from getMiniAgentConfig().mcpServerKeys)
   * @returns Filtered servers object
   */
  filterMcpServersForMiniAgent<T>(
    servers: Record<string, T>,
    allowedKeys: readonly string[]
  ): Record<string, T> {
    const filtered: Record<string, T> = {};
    for (const key of allowedKeys) {
      if (servers[key]) {
        filtered[key] = servers[key];
      }
    }
    return filtered;
  }

  // ============================================================
  // Session Recovery (unified across backends)
  // ============================================================

  /**
   * Build recovery context from previous messages when session resume fails.
   * Called when we detect an empty response or thread not found during resume.
   * Injects previous conversation context so the agent can continue naturally.
   *
   * @returns Formatted string to prepend to the user message, or null if no context available.
   */
  protected buildRecoveryContext(): string | null {
    return this.promptBuilder.buildRecoveryContext(this.config.getRecoveryMessages?.());
  }

  /**
   * Build one-time branch seed context for sessions branched from an earlier message.
   * Ensures the first turn in the new branch only sees transcript up to the selected branch point.
   */
  /** Clear session ID and notify callbacks when resume must start fresh. */
  protected clearSessionForRecovery(): void {
    this.config.onSdkSessionIdCleared?.();
    this.debug('Session cleared for recovery');
  }

  // ============================================================
  // Path Helpers
  // ============================================================

  /** Get this product session's durable storage path. */
  protected getSessionStoragePath(): string | undefined {
    if (!this.config.session?.id || !this.config.workspace.rootPath) return undefined;
    return getSessionPath(this.config.workspace.rootPath, this.config.session.id);
  }

  // ============================================================
  // Lifecycle (postInit, source runtime updates)
  // ============================================================

  /**
   * Post-construction initialization.
   * Default: no-op (auth already handled for Claude/Pi API-key).
   * Override in backends that need post-construction auth injection.
   */
  async postInit(): Promise<PostInitResult> {
    return { authInjected: true };
  }

  /**
   * Apply source runtime updates mid-session.
   * Default: no-op for backends that do not keep external source runtime state.
   */
  async applyBridgeUpdates(_context: BridgeUpdateContext): Promise<void> {
    // No-op by default
  }

  /**
   * Ensure branch sessions are backend-ready before first user message.
   * Default implementation is a no-op.
   */
  async ensureBranchReady(): Promise<void> {
    // No-op by default
  }

  /**
   * In-place rewind via provider-native tree navigation. Default: unsupported.
   */
  async rewindUserMessage(
    _visibleUserMessageId: string,
  ): Promise<{ editorText?: string }> {
    throw new Error(`${this.backendName} does not support in-place rewind`);
  }

  // ============================================================
  // Cleanup (common base, subclasses extend)
  // ============================================================

  /**
   * Alias for destroy() for consistency.
   */
  dispose(): void {
    this.destroy();
  }

  /**
   * Base cleanup - clears common resources.
   * Subclasses MUST call super.destroy() and add provider-specific cleanup.
   */
  destroy(): void {
    this.permissionManager.clearWhitelists();
    this.sourceManager.resetSeenSources();

    // Disconnect MCP pool to avoid connection leaks
    if (this.config.mcpPool) {
      this.config.mcpPool.disconnectAll().catch(err => {
        this.debug(`Failed to disconnect MCP pool: ${err instanceof Error ? err.message : String(err)}`);
      });
    }

    this.debug('Pi agent host destroyed');
  }

  // ============================================================
  // Pi Skill command preparation
  // ============================================================

  /**
   * Map Storyflow's persisted Skill mention to Pi's native /skill:name command.
   *
   * @param message - The user message containing potential skill mentions
   * @returns Object with:
   *   - skillCommand: Pi command, or null when no Skill is selected
   *   - cleanMessage: Message with the selected Skill mention removed
   *   - missingSkills: Array of skill slugs that were mentioned but not found
   */
  protected prepareSkillCommand(message: string) {
    const workingDirectory = this.config.session?.workingDirectory ?? this.workingDirectory;
    return preparePiSkillCommand(message, workingDirectory, debugMessage => this.debug(debugMessage));
  }

  // ============================================================
  // Chat entry point (template method)
  // ============================================================

  /**
   * Send a message and stream back events.
   * Validates Storyflow Skill mentions, maps one selection to Pi's native
   * command, then delegates to chatImpl.
   */
  async *chat(
    message: string,
    attachments?: FileAttachment[],
    options?: ChatOptions
  ): AsyncGenerator<AgentEvent> {
    const { skillCommand, cleanMessage, missingSkills, hasMultipleSkills } = await this.prepareSkillCommand(message);
    if (missingSkills.length > 0) {
      yield { type: 'error', message: `Skill(s) not found: ${missingSkills.join(', ')}` };
      yield { type: 'complete' };
      return;
    }

    if (hasMultipleSkills) {
      yield { type: 'error', message: 'Pi supports one top-level Skill per turn. Select a single Skill and try again.' };
      yield { type: 'complete' };
      return;
    }

    // Prepend branch seed context (for seeded branch sessions) and transferred-session summary.
    const branchSeedContext = buildBranchSeedContext(this.config.getBranchSeedMessages?.());
    if (branchSeedContext) {
      this.config.markBranchSeedApplied?.();
    }

    const transferredSessionSummary = this.config.getTransferredSessionSummary?.();
    const transferredSessionContext = transferredSessionSummary
      ? buildTransferredSessionContext(transferredSessionSummary)
      : null;
    if (transferredSessionContext) {
      this.config.markTransferredSessionSummaryApplied?.();
    }

    const messageBody = [branchSeedContext, transferredSessionContext, cleanMessage].filter(Boolean).join('\n\n');
    const effectiveMessage = skillCommand
      ? `${skillCommand}${messageBody ? ` ${messageBody}` : ''}`
      : messageBody;

    this._currentUserIteration = options?.userIteration;
    try {
      yield* this.chatImpl(effectiveMessage, attachments, options);
    } finally {
      this._currentUserIteration = undefined;
    }
  }

  // ============================================================
  // Abstract Methods (provider-specific, must be implemented)
  // ============================================================

  /**
   * Provider-specific chat implementation.
   * Called by chat() after Skill validation and Pi command mapping.
   *
   * @param message - User message (may begin with a Pi Skill command)
   * @param attachments - File attachments
   * @param options - Chat options (resume, retry, etc.)
   */
  protected abstract chatImpl(
    message: string,
    attachments?: FileAttachment[],
    options?: ChatOptions
  ): AsyncGenerator<AgentEvent>;

  /**
   * Abort current query (user stop or internal abort).
   */
  abstract abort(reason?: string): Promise<void>;

  /**
   * Force abort with specific reason.
   * Used for true hard-stop semantics (user stop, redirect fallback, teardown).
   */
  abstract forceAbort(reason: AbortReason): void;

  /**
   * Interrupt the current turn because control is being handed to the UI.
   *
   * Default implementation delegates to forceAbort(); backends can override
   * when handoff semantics differ from hard abort semantics.
   */
  interruptForHandoff(reason: AbortReason): void {
    this.forceAbort(reason);
  }

  /**
   * Redirect the agent mid-stream. Default: abort and let session layer re-send.
   * Override in backends that support native steering (e.g., Pi's steer()).
   */
  redirect(_message: string): boolean {
    this.forceAbort(AbortReason.Redirect);
    return false;
  }

  /**
   * Check if currently processing a query.
   */
  abstract isProcessing(): boolean;

  /**
   * Respond to a pending permission request.
   */
  abstract respondToPermission(requestId: string, allowed: boolean, alwaysAllow?: boolean): void;

  /**
   * Run a simple text completion using the agent's auth infrastructure.
   * No tools, no system prompt - just text in → text out.
   * Implemented by the active runtime.
   *
   * @param prompt - The prompt to send
   * @returns The model's response text, or null if completion fails
   */
  abstract runMiniCompletion(prompt: string): Promise<string | null>;

  /**
   * Execute an LLM query using the agent's auth infrastructure.
   * Used by call_llm tool (via queryFn callback) and potentially by runMiniCompletion.
   *
   * @param request - The query request (prompt, model, systemPrompt, etc.)
   * @returns The model's response text and optional token usage
   */
  abstract queryLlm(request: LLMQueryRequest): Promise<LLMQueryResult>;

  /**
   * Pre-execute a call_llm request: resolve attachments, validate model, run query.
   * Shared by Pi execution paths.
   */
  protected async preExecuteCallLlm(input: Record<string, unknown>): Promise<LLMQueryResult> {
    const sessionPath = getSessionPath(this.config.workspace.rootPath, this._sessionId);
    const request = await buildCallLlmRequest(input, {
      backendName: this.backendName,
      sessionPath,
      validateModel: this.validateCallLlmModel?.bind(this),
    });
    return this.queryLlm(request);
  }

  /**
   * Optional model validation hook for call_llm.
   * Override in subclasses to filter models (e.g., Codex rejects non-OpenAI models).
   * Return undefined to fall back to miniModel.
   */
  protected validateCallLlmModel?(modelId: string): string | undefined;

  /**
   * Pre-execute a spawn_session request: handle help mode or delegate to onSpawnSession.
   * Shared across all backends.
   */
  protected async preExecuteSpawnSession(
    input: Record<string, unknown>
  ): Promise<SpawnSessionResult | SpawnSessionHelpResult> {
    // Help mode — return available config info
    if (input.help) {
      return this.getSpawnSessionHelp();
    }

    // Spawn mode — validate and delegate
    const prompt = input.prompt as string | undefined;
    if (!prompt?.trim()) {
      throw new Error('prompt is required when not in help mode. Call with help=true to see available options.');
    }

    if (!this.onSpawnSession) {
      throw new Error('spawn_session is not available in this context.');
    }

    const request: SpawnSessionRequest = {
      prompt,
      name: input.name as string | undefined,
      llmConnection: input.llmConnection as string | undefined,
      model: input.model as string | undefined,
      enabledSourceSlugs: input.enabledSourceSlugs as string[] | undefined,
      permissionMode: input.permissionMode as SpawnSessionRequest['permissionMode'],
      thinkingLevel: input.thinkingLevel as SpawnSessionRequest['thinkingLevel'],
      labels: input.labels as string[] | undefined,
      workingDirectory: typeof input.workingDirectory === 'string' && input.workingDirectory
        ? expandPath(input.workingDirectory)
        : undefined,
      attachments: input.attachments as SpawnSessionRequest['attachments'],
    };

    return this.onSpawnSession(request);
  }

  /**
   * Get available connections, models, and sources for spawn_session help mode.
   */
  protected getSpawnSessionHelp(): SpawnSessionHelpResult {
    const connections = getLlmConnections();
    const defaultConnectionSlug = getDefaultLlmConnection();
    const allSources = loadAllSources(this.config.projectRoot);
    const activeSlugs = this.sourceManager.getActiveSlugs();

    return {
      connections: connections.map(c => ({
        slug: c.slug,
        name: c.name,
        isDefault: c.slug === defaultConnectionSlug,
        providerType: c.providerType,
        models: (c.models || []).map(m => typeof m === 'string' ? m : m.id),
        defaultModel: c.defaultModel,
      })),
      sources: allSources.map(s => ({
        slug: s.config.slug,
        name: s.config.name,
        type: s.config.type,
        enabled: activeSlugs.has(s.config.slug),
      })),
      defaults: {
        defaultConnection: defaultConnectionSlug,
        permissionMode: this.permissionManager.getPermissionMode(),
      },
    };
  }

  // ============================================================
  // Title Generation (shared implementation using runMiniCompletion)
  // ============================================================

  /**
   * Generate a session title from a user message.
   * Uses runMiniCompletion with the same auth as the main agent.
   *
   * @param message - The user's message to generate a title from
   * @param options.language - Preferred language for the title
   * @returns Generated title (2-5 words), or null if generation fails
   */
  async generateTitle(message: string, options?: { language?: string }): Promise<string | null> {
    try {
      const prompt = buildTitlePrompt(message, {
        ...options,
        language: options?.language ?? getCurrentLanguageName(),
      });
      const result = await this.runMiniCompletion(prompt);
      return validateTitle(result);
    } catch (error) {
      this.debug(`[generateTitle] Failed: ${error}`);
      return null;
    }
  }

  /**
   * Regenerate a session title based on recent conversation context.
   * Uses a spread of messages (first, middle, last) to capture the session's purpose.
   *
   * @param recentUserMessages - Spread of user messages
   * @param lastAssistantResponse - The most recent assistant response
   * @param options.language - Preferred language for the title
   * @returns Generated title (2-5 words), or null if generation fails
   */
  async regenerateTitle(recentUserMessages: string[], lastAssistantResponse: string, options?: { language?: string }): Promise<string | null> {
    try {
      const prompt = buildRegenerateTitlePrompt(
        recentUserMessages,
        lastAssistantResponse,
        {
          ...options,
          language: options?.language ?? getCurrentLanguageName(),
        },
      );
      const result = await this.runMiniCompletion(prompt);
      return validateTitle(result);
    } catch (error) {
      this.debug(`[regenerateTitle] Failed: ${error}`);
      return null;
    }
  }

  /**
   * Get a bound summarize callback for passing to API tool builders.
   * This allows MCP servers to summarize using the agent's auth infrastructure.
   */
  getSummarizeCallback(): (prompt: string) => Promise<string | null> {
    return this.runMiniCompletion.bind(this);
  }
}

// Re-export for convenience
export { AbortReason };
