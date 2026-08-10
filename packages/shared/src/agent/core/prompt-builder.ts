// input: Workspace/session metadata, source state, preferences, and current filesystem shape
// output: Per-turn system policy and data context blocks for Storyflow agent sessions
// pos: Shared prompt-context builder used by Claude and Pi-backed sessions

import { isLocalMcpEnabled } from '../../workspaces/storage.ts';
import { formatPreferencesForPrompt } from '../../config/preferences.ts';
import { formatSessionState } from '../mode-manager.ts';
import {
  getDateTimeContext,
  getProjectContextFilesPrompt,
  getWorkingDirectoryContext,
} from '../../prompts/system.ts';
import { formatLanguageReminderForPrompt } from '../../i18n/language-policy.ts';
import { getSessionPlansPath, getSessionDataPath, getSessionPath } from '../../sessions/storage.ts';
import {
  buildWorkspaceStructureSnapshot,
  renderWorkspaceStructureProjection,
} from './workspace-structure-context.ts';
import type {
  PromptBuilderConfig,
  ContextBlockOptions,
  RecoveryMessage,
  TurnProjection,
} from './types.ts';

/**
 * PromptBuilder provides utilities for building prompts and context blocks.
 *
 * Usage:
 * ```typescript
 * const promptBuilder = new PromptBuilder({
 *   workspace,
 *   session,
 *   debugMode: { enabled: true },
 * });
 *
 * // Build context blocks for a user message
 * const turnContext = promptBuilder.buildTurnContext({
 *   permissionMode: 'explore',
 *   plansFolderPath: '/path/to/plans',
 * });
 * ```
 */
export class PromptBuilder {
  private config: PromptBuilderConfig;
  private workspaceRootPath: string;
  private pinnedPreferencesPrompt: string | null = null;

  constructor(config: PromptBuilderConfig) {
    this.config = config;
    this.workspaceRootPath = config.workspace?.rootPath ?? '';
  }

  // ============================================================
  // Context Building
  // ============================================================

  /**
   * Build host policy and untrusted data as separate per-turn projections.
   *
   * @param options - Context building options
   * @param sourceState - Host policy plus Source-authored turn data
   * @returns System-policy and user-data context strings
   */
  buildTurnContext(
    options: ContextBlockOptions,
    sourceState?: TurnProjection
  ): { system: string[]; data: string[] } {
    const system: string[] = [];
    const data: string[] = [];

    // Keep the least volatile context first so provider caches can reuse the
    // longest possible prefix across turns.
    if (this.workspaceRootPath) {
      data.push(`<workspace_root>${this.workspaceRootPath}</workspace_root>`);
    }

    system.push(this.formatWorkspaceCapabilities());

    const workingDirContext = this.getWorkingDirectoryContext();
    if (workingDirContext) {
      data.push(workingDirContext);
    }

    const projectContextFiles = getProjectContextFilesPrompt(
      this.config.session?.workingDirectory ?? this.workspaceRootPath
    );
    if (projectContextFiles) {
      data.push(projectContextFiles);
    }

    const workspaceStructure = this.formatWorkspaceStructure();
    if (workspaceStructure) {
      if (workspaceStructure.policy) system.push(workspaceStructure.policy);
      data.push(workspaceStructure.data);
    }

    if (sourceState?.policy) {
      system.push(sourceState.policy);
    }
    if (sourceState?.data) {
      data.push(sourceState.data);
    }

    const sessionId = this.config.session?.id ?? `temp-${Date.now()}`;
    const plansFolderPath = options.plansFolderPath ??
      getSessionPlansPath(this.workspaceRootPath, sessionId);
    const dataFolderPath = options.dataFolderPath ??
      getSessionDataPath(this.workspaceRootPath, sessionId);
    system.push(formatSessionState(sessionId, {
      consumeModeChangeUserSignal: true,
    }));
    data.push(`<session_paths>\nplansFolderPath: ${plansFolderPath}\ndataFolderPath: ${dataFolderPath}\n</session_paths>`);

    // Current time changes every turn, so it must stay at the dynamic tail.
    system.push(getDateTimeContext());
    // Keep a final language reminder after provider-native Skills and other
    // discovered resources so human-facing output follows the selected locale.
    system.push(formatLanguageReminderForPrompt());

    return { system, data };
  }

  /**
   * Format workspace capabilities for prompt injection.
   * Informs the agent about what features are available in this workspace.
   */
  formatWorkspaceCapabilities(): string {
    const capabilities: string[] = [];

    // Check local MCP server capability
    const localMcpEnabled = isLocalMcpEnabled(this.workspaceRootPath);
    if (localMcpEnabled) {
      capabilities.push('local-mcp: enabled (stdio subprocess servers supported)');
    } else {
      capabilities.push('local-mcp: disabled (only HTTP/SSE servers)');
    }
    capabilities.push(
      'workspace-files: use filesystem tools for writes; only report success after the tool confirms it'
    );

    return `<workspace_capabilities>\n${capabilities.join('\n')}\n</workspace_capabilities>`;
  }

  /**
   * Get working directory context for prompt injection.
   */
  getWorkingDirectoryContext(): string | null {
    const sessionId = this.config.session?.id;
    const effectiveWorkingDir = this.config.session?.workingDirectory ??
      (sessionId ? getSessionPath(this.workspaceRootPath, sessionId) : undefined);
    const isSessionRoot = !this.config.session?.workingDirectory && !!sessionId;

    return getWorkingDirectoryContext(
      effectiveWorkingDir,
      isSessionRoot,
      this.config.session?.sdkCwd
    );
  }

  /**
   * Format the current workspace structure as a bounded per-turn anchor.
   */
  formatWorkspaceStructure(): TurnProjection | null {
    const sessionId = this.config.session?.id;
    const effectiveWorkingDir = this.config.session?.workingDirectory ??
      (sessionId ? getSessionPath(this.workspaceRootPath, sessionId) : undefined);
    const structureRoot = effectiveWorkingDir ?? this.workspaceRootPath;

    if (!structureRoot) return null;

    return renderWorkspaceStructureProjection(
      buildWorkspaceStructureSnapshot(structureRoot),
      {
        activeWorkspaceRoot: this.workspaceRootPath || undefined,
        workingDirectory: effectiveWorkingDir,
      },
    );
  }

  // ============================================================
  // Recovery Context
  // ============================================================

  /**
   * Build recovery context from previous messages when SDK resume fails.
   * Called when we detect an empty response during resume.
   *
   * @param messages - Previous messages to include in recovery context
   * @returns Formatted recovery context string, or null if no messages
   */
  buildRecoveryContext(messages?: RecoveryMessage[]): string | null {
    if (!messages || messages.length === 0) {
      return null;
    }

    // Format messages as a conversation block
    const formattedMessages = messages.map((m) => {
      const role = m.type === 'user' ? 'User' : 'Assistant';
      // Truncate very long messages to avoid bloating context
      const content = m.content.length > 1000
        ? m.content.slice(0, 1000) + '...[truncated]'
        : m.content;
      return `[${role}]: ${content}`;
    }).join('\n\n');

    return `<conversation_recovery>
This session was interrupted and is being restored. Here is the recent conversation context:

${formattedMessages}

Please continue the conversation naturally from where we left off.
</conversation_recovery>

`;
  }

  // ============================================================
  // User Preferences
  // ============================================================

  /**
   * Format user preferences for prompt injection.
   * Preferences are pinned on first call to ensure consistency within a session.
   *
   * @param forceRefresh - Force refresh of cached preferences
   * @returns Formatted preferences string
   */
  formatPreferences(forceRefresh = false): string {
    // Return pinned preferences if available (ensures session consistency)
    if (this.pinnedPreferencesPrompt && !forceRefresh) {
      return this.pinnedPreferencesPrompt;
    }

    // Load and format preferences (function loads internally)
    this.pinnedPreferencesPrompt = formatPreferencesForPrompt();
    return this.pinnedPreferencesPrompt;
  }

  /**
   * Clear pinned preferences (called on session clear).
   */
  clearPinnedPreferences(): void {
    this.pinnedPreferencesPrompt = null;
  }

  // ============================================================
  // Configuration Accessors
  // ============================================================

  /**
   * Update the workspace configuration.
   */
  setWorkspace(workspace: PromptBuilderConfig['workspace']): void {
    this.config.workspace = workspace;
    this.workspaceRootPath = workspace?.rootPath ?? '';
  }

  /**
   * Update the session configuration.
   */
  setSession(session: PromptBuilderConfig['session']): void {
    this.config.session = session;
  }

  /**
   * Get the workspace root path.
   */
  getWorkspaceRootPath(): string {
    return this.workspaceRootPath;
  }

  /**
   * Check if debug mode is enabled.
   */
  isDebugMode(): boolean {
    return this.config.debugMode?.enabled ?? false;
  }

  /**
   * Get the system prompt preset.
   */
  getSystemPromptPreset(): string {
    return this.config.systemPromptPreset ?? 'default';
  }
}
