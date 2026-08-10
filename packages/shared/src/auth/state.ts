/**
 * Unified Auth State Management
 *
 * Provides a single source of truth for all authentication state:
 * - Billing configuration (api_key or oauth_token)
 * - Workspace/MCP configuration
 *
 * Legacy credentials are migrated one-way during config startup. Token
 * refresh belongs to Pi ModelRuntime and is intentionally absent here.
 */

import { getCredentialManager } from '../credentials/index.ts';
import {
  getActiveWorkspace,
  getDefaultLlmConnection,
  getLlmConnection,
  type AuthType,
  type Workspace,
} from '../config/storage.ts';
import { isLocalConnection } from '../config/llm-connections.ts';

function toLegacyBillingType(
  authType: NonNullable<ReturnType<typeof getLlmConnection>>['authType'],
): AuthType {
  switch (authType) {
    case 'oauth':
      return 'oauth_token'
    case 'api_key':
    case 'api_key_with_endpoint':
    case 'bearer_token':
    case 'iam_credentials':
    case 'service_account_file':
    case 'environment':
    case 'none':
      return 'api_key'
  }
}

// ============================================
// Types
// ============================================

export interface AuthState {
  /** Claude API billing configuration */
  billing: {
    /** Configured billing type, or null if not yet configured */
    type: AuthType | null;
    /** True if we have the required credentials for the configured billing type */
    hasCredentials: boolean;
    /** Anthropic API key (if using api_key auth type) */
    apiKey: string | null;
    /** Claude Max OAuth token (if using oauth_token auth type) */
    claudeOAuthToken: string | null;
  };

  /** Workspace/MCP configuration */
  workspace: {
    hasWorkspace: boolean;
    active: Workspace | null;
  };
}

export interface SetupNeeds {
  /** No billing type configured → show billing picker */
  needsBillingConfig: boolean;
  /** Billing type set but missing credentials → show credential entry */
  needsCredentials: boolean;
  /** Everything complete → go straight to App */
  isFullyConfigured: boolean;
}

/**
 * Get complete authentication state from all sources (config file + credential store)
 *
 * Uses LLM connections as the source of truth for auth type and credentials.
 * Legacy global credentials are not consulted at runtime.
 */
export async function getAuthState(): Promise<AuthState> {
  const manager = getCredentialManager();
  const activeWorkspace = getActiveWorkspace();

  // Get the default LLM connection to determine auth type
  const defaultConnectionSlug = getDefaultLlmConnection();
  const connection = defaultConnectionSlug ? getLlmConnection(defaultConnectionSlug) : null;

  // Determine auth type from connection (no legacy fallback - migration ensures all users have connections)
  let effectiveAuthType: AuthType | null = null;
  if (connection) {
    // Any configured default connection counts as billing-configured,
    // including environment/IAM auth (Bedrock, Vertex).
    effectiveAuthType = toLegacyBillingType(connection.authType)
  }
  // No fallback to legacy config.authType - if no connection, return unauthenticated state

  // Check credentials based on the effective auth type and connection
  let hasCredentials = false;
  let apiKey: string | null = null;
  let claudeOAuthToken: string | null = null;

  if (connection && defaultConnectionSlug) {
    if (connection.authType === 'api_key' || connection.authType === 'api_key_with_endpoint' || connection.authType === 'bearer_token') {
      apiKey = await manager.getLlmApiKey(defaultConnectionSlug);
      hasCredentials = !!apiKey;
      const isManagedBuiltinGateway = connection.managed === true && connection.source === 'builtin';
      // Local loopback runtimes are keyless. Managed bundled gateways are also
      // hidden app infrastructure: their credentials come from bundled secrets
      // or client auth, not from user-facing API-key setup.
      if (!apiKey && (isLocalConnection(connection) || isManagedBuiltinGateway)) {
        hasCredentials = true;
      }
    } else if (connection.authType === 'oauth') {
      // Pass providerType for OAuth routing (OpenAI OAuth needs idToken)
      hasCredentials = await manager.hasLlmCredentials(defaultConnectionSlug, connection.authType, connection.providerType);
      const llmOAuth = await manager.getLlmOAuth(defaultConnectionSlug);
      if (llmOAuth?.accessToken) {
        claudeOAuthToken = llmOAuth.accessToken;
      }
    } else {
      hasCredentials = await manager.hasLlmCredentials(defaultConnectionSlug, connection.authType, connection.providerType);
    }
    // Other auth types (iam_credentials, service_account_file, environment, none) are handled by hasLlmCredentials
    // OpenAI OAuth credentials are handled separately by CodexAgent
  } else {
    // No connection configured - credentials not available
    // Legacy migration should have created a default connection
    hasCredentials = false;
  }

  return {
    billing: {
      type: effectiveAuthType,
      hasCredentials,
      apiKey,
      claudeOAuthToken,
    },
    workspace: {
      hasWorkspace: !!activeWorkspace,
      active: activeWorkspace,
    },
  };
}

/**
 * Derive what setup steps are needed based on current auth state
 */
export function getSetupNeeds(state: AuthState, setupDeferred?: boolean): SetupNeeds {
  // Need billing config if no billing type is set
  const needsBillingConfig = state.billing.type === null;

  // Need credentials if billing type is set but credentials are missing
  const needsCredentials = state.billing.type !== null && !state.billing.hasCredentials;

  return {
    needsBillingConfig,
    needsCredentials,
    // Fully configured if setup is complete OR user chose "Setup later"
    isFullyConfigured: (!needsBillingConfig && !needsCredentials) || !!setupDeferred,
  };
}
