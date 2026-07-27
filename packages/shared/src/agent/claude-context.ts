/**
 * input: Workspace/session paths, callbacks, validators, Sources, and credential adapters
 * output: SessionToolContext backed by shared runtime services
 * pos: Adapter boundary between session-tools-core contracts and shared implementations
 *
 * Creates a SessionToolContext implementation for Claude with full access
 * to Electron internals, credential managers, MCP validation, etc.
 *
 * This enables the shared handlers in session-tools-core to work with
 * Claude's full feature set.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { CONFIG_DIR } from '../config/paths.ts';
import { getWorkspaceSourcesPath } from '../workspaces/paths.ts';
import type {
  SessionToolContext,
  SessionToolCallbacks,
  UserQuestionRequest,
  UserQuestionResponse,
  FileSystemInterface,
  CredentialManagerInterface,
  ValidatorInterface,
  LoadedSource,
  StdioMcpConfig,
  StdioValidationResult,
  HttpMcpConfig,
  McpValidationResult,
  ApiTestResult,
  SourceConfig,
  DeveloperFeedback,
} from '@craft-agent/session-tools-core';
import {
  validateConfig,
  validateSource,
  validateAllSources,
  validateStatuses,
  validatePreferences,
  validateAll,
  validateWorkspacePermissions,
  validateSourcePermissions,
  validateAllPermissions,
  validateToolIcons,
} from '../config/validators.ts';
import { validateAutomations } from '../automations/index.ts';
import {
  validateMcpConnection as validateMcpConnectionImpl,
  validateStdioMcpConnection as validateStdioMcpConnectionImpl,
} from '../mcp/validation.ts';
import {
  loadSource as loadSourceImpl,
  saveSourceConfig as saveSourceConfigImpl,
  updateSourceConnectionState,
  getSourcePath,
  GLOBAL_AGENT_ROOT_DIR,
  SHARED_AGENTS_ROOT_DIR,
} from '../sources/storage.ts';
import type {
  FolderSourceConfig,
  LoadedSource as SharedLoadedSource,
  SourceConnectionStatus,
} from '../sources/types.ts';
import { getSourceCredentialManager } from '../sources/credential-manager.ts';
import {
  inferGoogleServiceFromUrl,
  inferSlackServiceFromUrl,
  inferMicrosoftServiceFromUrl,
  type GoogleService,
  type SlackService,
  type MicrosoftService,
} from '../sources/types.ts';
import { isGoogleOAuthConfigured as isGoogleOAuthConfiguredImpl } from '../auth/google-oauth.ts';
import { debug } from '../utils/debug.ts';
import { getSessionPlansPath, getSessionPath, getSessionDataPath } from '../sessions/storage.ts';
import { updatePreferences as updatePreferencesImpl } from '../config/preferences.ts';
import {
  createSkill as createSkillImpl,
  loadSkill as loadSkillImpl,
} from '../skills/storage.ts';

// Re-export types that may be needed by consumers
export type { SessionToolContext, SessionToolCallbacks } from '@craft-agent/session-tools-core';

/**
 * Options for creating a Claude context
 */
export interface ClaudeContextOptions {
  sessionId: string;
  workspacePath: string;
  workspaceId: string;
  onPlanSubmitted: (planPath: string) => void;
  onAuthRequest: (request: unknown) => void;
  onAskUserQuestion?: (request: UserQuestionRequest) => Promise<UserQuestionResponse>;
}

/**
 * Create a SessionToolContext for Claude with full capabilities.
 *
 * This provides:
 * - Full file system access
 * - Full Zod validators
 * - Credential manager with keychain access
 * - MCP connection validation
 * - Icon management
 */
export function createClaudeContext(options: ClaudeContextOptions): SessionToolContext {
  const { sessionId, workspacePath, workspaceId, onPlanSubmitted, onAuthRequest, onAskUserQuestion } = options;
  void workspaceId;

  // File system implementation
  const fs: FileSystemInterface = {
    exists: (path: string) => existsSync(path),
    readFile: (path: string) => readFileSync(path, 'utf-8'),
    readFileBuffer: (path: string) => readFileSync(path),
    writeFile: (path: string, content: string) => writeFileSync(path, content, 'utf-8'),
    isDirectory: (path: string) => existsSync(path) && statSync(path).isDirectory(),
    readdir: (path: string) => readdirSync(path),
    stat: (path: string) => {
      const stats = statSync(path);
      return {
        size: stats.size,
        isDirectory: () => stats.isDirectory(),
      };
    },
  };

  // Callbacks implementation
  const callbacks: SessionToolCallbacks = {
    onPlanSubmitted,
    onAuthRequest: (request) => onAuthRequest(request),
    onAskUserQuestion,
  };

  // Validators implementation
  const validators: ValidatorInterface = {
    validateConfig: () => validateConfig(),
    validateSource: (wsPath: string, slug: string) => validateSource(wsPath, slug),
    validateAllSources: (wsPath: string) => validateAllSources(wsPath),
    validateStatuses: (wsPath: string) => validateStatuses(wsPath),
    validatePreferences: () => validatePreferences(),
    validatePermissions: (wsPath: string, sourceSlug?: string) => {
      if (sourceSlug) {
        return validateSourcePermissions(wsPath, sourceSlug);
      }
      return validateAllPermissions(wsPath);
    },
    validateAutomations: (wsPath: string) => validateAutomations(wsPath),
    validateToolIcons: () => validateToolIcons(),
    validateAll: (wsPath: string) => validateAll(wsPath),
  };

  // Credential manager adapter
  const toSharedLoadedSource = (source: LoadedSource): SharedLoadedSource => ({
    config: source.config as unknown as FolderSourceConfig,
    guide: null,
    folderPath: source.folderPath,
    workspaceRootPath: source.workspaceRootPath,
    workspaceId: source.workspaceId,
    origin: source.workspaceRootPath === SHARED_AGENTS_ROOT_DIR
      ? 'shared-global'
      : source.workspaceRootPath === GLOBAL_AGENT_ROOT_DIR
        ? 'craft-global'
        : 'workspace',
  });

  const normalizeConnectionStatus = (
    status: SourceConfig['connectionStatus'],
  ): SourceConnectionStatus | undefined => {
    switch (status) {
      case 'connected': return 'connected';
      case 'error':
      case 'disconnected': return 'failed';
      case 'unknown': return 'untested';
      default: return undefined;
    }
  };

  const credentialManager: CredentialManagerInterface = {
    hasValidCredentials: async (source: LoadedSource): Promise<boolean> => {
      const mgr = getSourceCredentialManager();
      const token = await mgr.getToken(toSharedLoadedSource(source));
      return !!token;
    },
    getToken: async (source: LoadedSource): Promise<string | null> => {
      const mgr = getSourceCredentialManager();
      return mgr.getToken(toSharedLoadedSource(source));
    },
    refresh: async (source: LoadedSource): Promise<string | null> => {
      const mgr = getSourceCredentialManager();
      return mgr.refresh(toSharedLoadedSource(source));
    },
  };

  // MCP validation
  const validateStdioMcpConnection = async (config: StdioMcpConfig): Promise<StdioValidationResult> => {
    try {
      const result = await validateStdioMcpConnectionImpl(config);
      return {
        success: result.success,
        error: result.error,
        toolCount: result.tools?.length,
        toolNames: result.tools,
        serverName: result.serverInfo?.name,
        serverVersion: result.serverInfo?.version,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Validation failed' };
    }
  };

  const validateMcpConnection = async (config: HttpMcpConfig): Promise<McpValidationResult> => {
    try {
      const result = await validateMcpConnectionImpl({
        mcpUrl: config.url,
        mcpTransport: config.transport,
        mcpHeaders: config.headers,
      });
      return {
        success: result.success,
        error: result.error,
        needsAuth: result.errorType === 'needs-auth',
        toolCount: result.tools?.length,
        toolNames: result.tools,
        serverName: result.serverInfo?.name,
        serverVersion: result.serverInfo?.version,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Validation failed' };
    }
  };

  // Build context
  const context: SessionToolContext = {
    sessionId,
    workspacePath,
    get sourcesPath() { return getWorkspaceSourcesPath(workspacePath); },
    get skillsPath() { return join(CONFIG_DIR, 'skills'); },
    plansFolderPath: getSessionPlansPath(workspacePath, sessionId),
    sessionPath: getSessionPath(workspacePath, sessionId),
    dataPath: getSessionDataPath(workspacePath, sessionId),
    callbacks,
    fs,
    validators,
    credentialManager,
    updatePreferences: (updates: Record<string, unknown>) => {
      updatePreferencesImpl(updates as any);
    },
    submitFeedback: (feedback: DeveloperFeedback) => {
      const feedbackDir = join(CONFIG_DIR, 'feedback');
      mkdirSync(feedbackDir, { recursive: true });
      const filePath = join(feedbackDir, `${feedback.id}.json`);
      writeFileSync(filePath, JSON.stringify(feedback, null, 2), 'utf-8');
      debug('claude-context', `Developer feedback written to ${filePath}`);
    },
    // Source management
    loadSourceConfig: (sourceSlug: string): SourceConfig | null => {
      const source = loadSourceImpl(workspacePath, sourceSlug);
      return source?.config as unknown as SourceConfig | null;
    },
    createSkillDocument: (skillSlug: string, content: string) => {
      const skill = createSkillImpl(skillSlug, content);
      const path = join(skill.path, 'SKILL.md');
      return { path, content };
    },
    loadSkillDocument: (skillSlug: string) => {
      const skill = loadSkillImpl(skillSlug);
      if (!skill) return null;
      const path = join(skill.path, 'SKILL.md');
      return { path, content: readFileSync(path, 'utf-8') };
    },
    isSourceDefinitionReadOnly: (sourceSlug: string): boolean => {
      return loadSourceImpl(workspacePath, sourceSlug)?.origin === 'shared-global';
    },
    saveSourceConfig: (source: SourceConfig) => {
      const loaded = loadSourceImpl(workspacePath, source.slug);
      if (!loaded) return;

      const connectionStatus = normalizeConnectionStatus(source.connectionStatus);
      if (loaded.origin === 'shared-global') {
        updateSourceConnectionState(workspacePath, source.slug, {
          connectionStatus,
          connectionError: source.connectionError,
          lastTestedAt: source.lastTestedAt,
        });
        return;
      }

      saveSourceConfigImpl(loaded.workspaceRootPath, {
        ...source,
        connectionStatus,
      } as unknown as FolderSourceConfig);
    },

    // Service inference
    inferGoogleService: (url?: string): GoogleService | undefined => {
      return inferGoogleServiceFromUrl(url);
    },
    inferSlackService: (url?: string): SlackService | undefined => {
      return inferSlackServiceFromUrl(url);
    },
    inferMicrosoftService: (url?: string): MicrosoftService | undefined => {
      return inferMicrosoftServiceFromUrl(url);
    },

    // OAuth config check
    isGoogleOAuthConfigured: (clientId?: string, clientSecret?: string): boolean => {
      return isGoogleOAuthConfiguredImpl(clientId, clientSecret);
    },

    // MCP validation
    validateStdioMcpConnection,
    validateMcpConnection,

    // Icon helpers (simplified - full implementation would use logo.ts)
    isIconUrl: (value: string): boolean => {
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    },

    deriveServiceUrl: (source: SourceConfig): string | null => {
      if (source.type === 'api' && source.api?.baseUrl) {
        try {
          const url = new URL(source.api.baseUrl);
          return `${url.protocol}//${url.hostname}`;
        } catch {
          return null;
        }
      }
      if (source.type === 'mcp' && source.mcp?.url) {
        try {
          const url = new URL(source.mcp.url);
          return `${url.protocol}//${url.hostname}`;
        } catch {
          return null;
        }
      }
      return null;
    },

    // Session self-management bindings are attached externally via
    // attachSessionSelfManagementBindings() — not part of the factory.
  };

  return context;
}
