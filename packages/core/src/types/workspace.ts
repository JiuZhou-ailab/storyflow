// input: Workspace identity, catalog metadata, and optional remote connection details
// output: Shared workspace DTOs plus the explicit client-safe WorkspaceInfo projection
// pos: Canonical workspace type definitions

/**
 * Workspace and authentication types
 */

/**
 * How MCP server should be authenticated (workspace-level)
 * Note: Different from SourceMcpAuthType which uses 'oauth' | 'bearer' | 'none' for individual sources
 */
export type McpAuthType = 'workspace_oauth' | 'workspace_bearer' | 'public';
/**
 * Configuration for a remote Craft Agent Server.
 * When set on a workspace, handler calls are proxied over WebSocket.
 */
export interface RemoteServerConfig {
  url: string;              // ws://host:port or wss://host:port
  credentialRef: string;    // Opaque reference to the encrypted server token
  remoteWorkspaceId: string; // ID of the workspace on the remote server
}

/** Trusted connection input accepted at credential capture boundaries only. */
export interface RemoteServerConnectionInput {
  url: string;
  token: string;
  remoteWorkspaceId: string;
}

/**
 * Client-facing workspace DTO — safe to send over RPC to remote clients.
 * Does not expose server-internal filesystem paths.
 */
export interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;              // Server-computed from rootPath basename
  lastAccessedAt?: number;
  archivedAt?: number;
  iconUrl?: string;
  mcpUrl?: string;
  mcpAuthType?: McpAuthType;
  remoteServer?: RemoteServerConfig;
}

/**
 * Full workspace with server-internal details.
 * Used by server code and local Electron renderer (LOCAL_ONLY channels).
 */
export interface Workspace extends WorkspaceInfo {
  rootPath: string;        // Absolute path to local workspace folder (metadata, config). Auto-created for remote workspaces.
  createdAt: number;
  /** Host-owned executable defaults; Project files cannot self-grant these values. */
  defaultPermissionMode?: 'safe' | 'ask' | 'allow-all';
  /** Exact Source capabilities (`origin:slug:definitionIdentity`); legacy bare slugs fail closed. */
  defaultEnabledSourceRefs?: string[];
  /** Directory metadata fingerprint used only to verify explicit relink targets. */
  directoryConfigId?: string;
  localMcpEnabled?: boolean;
  automationsEnabled?: boolean;
  /** Derived local runtime state. Never persisted and always available for remote workspaces. */
  rootAvailable?: boolean;
}

/** Project a Host Workspace onto the exact client-safe RPC contract. */
export function toWorkspaceInfo(workspace: Workspace): WorkspaceInfo {
  const info: WorkspaceInfo = {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
  }
  if (workspace.lastAccessedAt !== undefined) info.lastAccessedAt = workspace.lastAccessedAt
  if (workspace.archivedAt !== undefined) info.archivedAt = workspace.archivedAt
  if (workspace.iconUrl !== undefined) info.iconUrl = workspace.iconUrl
  if (workspace.mcpUrl !== undefined) info.mcpUrl = workspace.mcpUrl
  if (workspace.mcpAuthType !== undefined) info.mcpAuthType = workspace.mcpAuthType
  if (workspace.remoteServer !== undefined) {
    info.remoteServer = {
      url: workspace.remoteServer.url,
      credentialRef: workspace.remoteServer.credentialRef,
      remoteWorkspaceId: workspace.remoteServer.remoteWorkspaceId,
    }
  }
  return info
}

/**
 * Authentication type for AI provider
 * - api_key: Anthropic API key
 * - oauth_token: Claude Max OAuth (Anthropic)
 * - codex_oauth: ChatGPT Plus OAuth via Codex app-server
 * - codex_api_key: OpenAI API key via Codex (OpenRouter, Vercel AI Gateway compatible)
 */
export type AuthType = 'api_key' | 'oauth_token' | 'codex_oauth' | 'codex_api_key';

/**
 * OAuth credentials from a fresh authentication flow.
 * Used for temporary state in UI components before saving to credential store.
 */
export interface OAuthCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  clientId: string;
  tokenType: string;
}

// Config stored in JSON file (credentials stored in encrypted file, not here)
export interface StoredConfig {
  authType?: AuthType;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  activeSessionId: string | null;  // Currently active session (primary scope)
  model?: string;
}
