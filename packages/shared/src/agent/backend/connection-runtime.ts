// input: LLM connections, core agent configuration, credentials, and host runtime paths
// output: Resolved Pi configuration, model discovery, and connection validation
// pos: Pure configuration boundary between product connections and the Pi runtime

/** Storyflow has one runtime. This module resolves data; callers construct PiAgent directly. */

import type {
  AgentProvider,
  LlmAuthType,
  CoreBackendConfig,
  BackendHostRuntimeContext,
} from './types.ts';
import { PiAgent } from '../pi-agent.ts';
import { getLlmConnection, getLlmConnections, getDefaultLlmConnection, type LlmConnection } from '../../config/storage.ts';
import type { CustomEndpointConfig } from '../../config/llm-connections.ts';
// Import validation helpers for provider-auth combinations
import {
  isManagedLlmConnectionSlug,
  isValidProviderAuthCombination,
} from '../../config/llm-connections.ts';
import { parseValidationError } from '../../config/llm-validation.ts';
import type { ModelFetchResult } from '../../config/model-fetcher.ts';
// Model resolution utilities
import { homedir } from 'node:os';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { getCredentialManager } from '../../credentials/index.ts';
import type {
  BackendModelFetchCredentials,
  BackendProviderOptions,
  BackendResolutionContext,
  ResolvedBackendConfig,
  StoredConnectionValidationResult,
} from './internal/driver-types.ts';
import { getDefaultProviderType } from './internal/driver-types.ts';
import {
  resolveBackendHostTooling as resolveHostToolingPaths,
  resolveBackendRuntimePaths,
} from './internal/runtime-resolver.ts';
import { buildPiRuntime, fetchPiModels } from './internal/drivers/pi.ts';
import { getSourcePath } from '../../sources/storage.ts';

/** Resolve the complete PiAgent configuration without constructing runtime state. */
export function resolvePiAgentConfig(args: {
  context: ResolvedBackendContext;
  coreConfig: CoreBackendConfig;
  hostRuntime: BackendHostRuntimeContext;
  providerOptions?: BackendProviderOptions;
}): ResolvedBackendConfig {
  const { context, coreConfig, hostRuntime, providerOptions } = args;
  const resolvedPaths = resolveBackendRuntimePaths(hostRuntime);
  const runtime = buildPiRuntime({
    context,
    resolvedPaths,
    providerOptions,
  });

  return {
    ...coreConfig,
    providerType: context.connection?.providerType ?? 'pi',
    authType: context.authType || 'api_key',
    model: context.resolvedModel,
    connectionSlug: context.connection?.slug,
    runtime,
  };
}

/**
 * Initialize backend host runtime wiring once at app startup.
 * Keeps Pi runtime/bootstrap details behind backend internals.
 */
export function initializeBackendHostRuntime(args: {
  hostRuntime: BackendHostRuntimeContext;
}): void {
  resolveBackendRuntimePaths(args.hostRuntime);
}

/**
 * Resolve backend-managed host tooling paths (e.g. ripgrep) from generic host runtime metadata.
 */
export function resolveBackendHostTooling(args: {
  hostRuntime: BackendHostRuntimeContext;
}): {
  ripgrepPath?: string;
} {
  return resolveHostToolingPaths(args.hostRuntime);
}

// ============================================================
// LLM Connection Support
// ============================================================

/**
 * @deprecated Use LlmAuthType directly - no mapping needed.
 * Map legacy LLM auth type to backend auth type.
 *
 * @param authType - The legacy LLM connection auth type
 * @returns The corresponding backend auth type
 */
export function connectionAuthTypeToBackendAuthType(
  authType: LlmAuthType
): LlmAuthType | undefined {
  switch (authType) {
    case 'api_key':
    case 'api_key_with_endpoint':
    case 'oauth':
    case 'bearer_token':
    case 'iam_credentials':
    case 'service_account_file':
      // Pass through auth types that the backend handles
      return authType;
    case 'none':
    case 'environment':
      // These auth types don't require explicit credential passing
      return undefined;
  }
}

/**
 * Get LLM connection for a session.
 * Resolution order: session.llmConnection > workspace.defaults.defaultLlmConnection > global default
 *
 * @param sessionConnection - Connection slug from session (may be undefined)
 * @param workspaceDefaultConnection - Workspace default connection (may be undefined)
 * @returns The resolved LLM connection or null if not found
 */
export function resolveSessionConnection(
  sessionConnection?: string,
  workspaceDefaultConnection?: string
): LlmConnection | null {
  // 1. Session-level connection (locked after first message)
  if (sessionConnection) {
    const connection = getLlmConnection(sessionConnection);
    if (connection) return connection;
  }

  // 2. Workspace default
  if (workspaceDefaultConnection) {
    const connection = getLlmConnection(workspaceDefaultConnection);
    if (connection) return connection;
  }

  // 3. Global default
  const defaultSlug = getDefaultLlmConnection();
  if (!defaultSlug) return null;
  return getLlmConnection(defaultSlug);
}

/**
 * Provider-agnostic resolution result used by session/ipc orchestration.
 */
export interface ResolvedBackendContext extends BackendResolutionContext {}

export function resolveManagedModelConnection(
  connection: LlmConnection | null,
  managedModel: string | undefined,
  connections: LlmConnection[],
): LlmConnection | null {
  if (!connection || !managedModel || !isManagedLlmConnectionSlug(connection.slug)) {
    return connection;
  }

  const hasModel = (candidate: LlmConnection) =>
    candidate.models?.some(model => (typeof model === 'string' ? model : model.id) === managedModel);

  if (hasModel(connection)) return connection;
  return connections.find(candidate =>
    isManagedLlmConnectionSlug(candidate.slug) && hasModel(candidate)
  ) ?? connection;
}

/**
 * Resolve connection + provider/auth/model/capabilities in one call.
 * This keeps main-process orchestration free from provider-specific branching.
 */
export function resolveBackendContext(args: {
  sessionConnectionSlug?: string;
  workspaceDefaultConnectionSlug?: string;
  managedModel?: string;
}): ResolvedBackendContext {
  const connection = resolveManagedModelConnection(
    resolveSessionConnection(
      args.sessionConnectionSlug,
      args.workspaceDefaultConnectionSlug
    ),
    args.managedModel,
    getLlmConnections(),
  );

  const authType = connection
    ? connectionAuthTypeToBackendAuthType(connection.authType)
    : undefined;

  const resolvedModel = resolveModelForConnection(args.managedModel, connection);

  return {
    connection,
    authType,
    resolvedModel,
  };
}

/** Resolve and validate one explicitly selected connection. */
export function resolveRequiredBackendContext(
  connectionSlug: string,
  managedModel?: string,
): ResolvedBackendContext {
  const connection = getLlmConnection(connectionSlug);
  if (!connection) throw new Error(`LLM connection not found: ${connectionSlug}`);
  if (!isValidProviderAuthCombination(connection.providerType, connection.authType)) {
    throw new Error(
      `Invalid LLM connection configuration: provider '${connection.providerType}' `
      + `does not support auth type '${connection.authType}'. `
      + `Please update the connection settings for '${connection.name}'.`,
    );
  }
  return {
    connection,
    authType: connectionAuthTypeToBackendAuthType(connection.authType),
    resolvedModel: resolveModelForConnection(managedModel, connection),
  };
}

/**
 * Resolve provider hint for setup-time connection tests.
 * Keeps provider-specific hint mapping out of Electron main IPC handlers.
 */
export function resolveSetupTestConnectionHint(args: {
  provider: AgentProvider;
  baseUrl?: string;
  piAuthProvider?: string;
  customEndpoint?: CustomEndpointConfig;
}): Pick<LlmConnection, 'providerType' | 'piAuthProvider' | 'customEndpoint'> {
  if (args.provider === 'pi') {
    if (args.customEndpoint && args.baseUrl?.trim()) {
      return {
        providerType: 'pi_compat',
        piAuthProvider: args.customEndpoint.api === 'anthropic-messages'
          ? 'anthropic'
          : args.customEndpoint.api === 'google-generative-ai'
            ? 'google'
            : 'openai',
        customEndpoint: args.customEndpoint,
      };
    }

    return {
      providerType: 'pi',
      piAuthProvider: args.piAuthProvider,
    };
  }

  return {
    providerType: args.baseUrl ? 'pi_compat' : 'anthropic',
  };
}

/**
 * Provider-agnostic model discovery for model refresh flows.
 * Uses Pi's model-provider catalog while keeping connection details internal.
 */
export async function fetchBackendModels(args: {
  connection: LlmConnection;
  credentials: BackendModelFetchCredentials;
  hostRuntime: BackendHostRuntimeContext;
  timeoutMs?: number;
}): Promise<ModelFetchResult> {
  resolveBackendRuntimePaths(args.hostRuntime);
  return fetchPiModels({
    connection: args.connection,
    credentials: args.credentials,
  });
}

/**
 * Provider-agnostic stored-connection validation.
 * Moves provider/auth branching out of Electron main IPC handlers.
 */
export async function validateStoredBackendConnection(args: {
  slug: string;
  hostRuntime: BackendHostRuntimeContext;
}): Promise<StoredConnectionValidationResult> {
  try {
    const connection = getLlmConnection(args.slug);
    if (!connection) {
      return { success: false, error: 'Connection not found' };
    }

    const credentialManager = getCredentialManager();
    const hasCredentials = await credentialManager.hasLlmCredentials(
      args.slug,
      connection.authType,
      connection.providerType,
    );

    if (!hasCredentials && connection.authType !== 'none') {
      return { success: false, error: 'No credentials configured' };
    }

    resolveBackendRuntimePaths(args.hostRuntime);
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: parseValidationError(msg) };
  }
}

// ============================================================
// Model Resolution
// ============================================================

/**
 * Resolve the model ID from session selection and its LLM connection.
 *
 * @param managedModel - The model stored on the session (user's choice)
 * @param connection - The LLM connection config (has defaultModel and models[])
 * @returns Resolved model ID string
 */
export function resolveModelForConnection(
  managedModel: string | undefined,
  connection: LlmConnection | null
): string {
  return managedModel || connection?.defaultModel || '';
}

// ============================================================
// Runtime Artifact Helpers
// ============================================================

/**
 * Remove backend runtime artifacts for disabled sources.
 * Currently removes bridge credential cache files in source directories.
 */
export async function cleanupSourceRuntimeArtifacts(
  workspaceRootPath: string,
  disabledSourceSlugs: string[],
): Promise<void> {
  for (const sourceSlug of disabledSourceSlugs) {
    const cachePath = join(getSourcePath(workspaceRootPath, sourceSlug), '.credential-cache.json');
    await rm(cachePath, { force: true });
  }
}

// ============================================================
// Provider-Agnostic Connection Testing
// ============================================================

export async function testBackendConnection(args: {
  provider: AgentProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
  hostRuntime: BackendHostRuntimeContext;
  timeoutMs?: number;
  allowEmptyApiKey?: boolean;
  connection?: Pick<LlmConnection, 'providerType' | 'piAuthProvider' | 'customEndpoint'>;
}): Promise<{ success: boolean; error?: string }> {
  const trimmedKey = args.apiKey.trim();
  if (!trimmedKey && !args.allowEmptyApiKey) {
    return { success: false, error: 'API key is required' };
  }

  const tempSlug = `__test-${Date.now()}`;
  const cm = getCredentialManager();
  if (trimmedKey) {
    await cm.setLlmApiKey(tempSlug, trimmedKey);
  }

  try {
    const testModel = args.model;
    const providerType = args.connection?.providerType ?? getDefaultProviderType(args.provider);
    const now = Date.now();
    const authType: LlmAuthType = (
      providerType === 'pi_compat'
    )
      ? 'api_key_with_endpoint'
      : 'api_key';

    const syntheticConnection = {
      slug: tempSlug,
      name: 'Temporary Connection Test',
      providerType,
      authType,
      defaultModel: testModel,
      createdAt: now,
      piAuthProvider: args.connection?.piAuthProvider,
      customEndpoint: args.connection?.customEndpoint,
      ...(args.baseUrl?.trim() ? { baseUrl: args.baseUrl.trim() } : {}),
    } as LlmConnection;

    const context: ResolvedBackendContext = {
      connection: syntheticConnection,
      authType,
      resolvedModel: testModel,
    };

    const cwd = homedir();
    const agent = new PiAgent(resolvePiAgentConfig({
      context,
      coreConfig: {
        workspace: { id: '__test', name: 'Connection Test', slug: '__test', rootPath: cwd, createdAt: 0 },
        session: { id: `test-${now}`, workspaceRootPath: cwd, createdAt: 0, lastUsedAt: 0 },
        isHeadless: true,
        miniModel: testModel,
        envOverrides: providerType === 'anthropic'
          ? {
            ANTHROPIC_API_KEY: trimmedKey,
            ...(args.baseUrl?.trim() ? { ANTHROPIC_BASE_URL: args.baseUrl.trim() } : {}),
          }
          : undefined,
      },
      hostRuntime: args.hostRuntime,
      providerOptions: { piAuthProvider: args.connection?.piAuthProvider },
    }));

    const readAgentStderr = (): string => {
      const maybe = agent as unknown as { getRecentStderr?: () => string };
      return typeof maybe.getRecentStderr === 'function' ? maybe.getRecentStderr() : '';
    };
    const withStderrContext = (message: string): string => {
      const stderr = readAgentStderr();
      if (!stderr) return `${message} (subprocess produced no stderr output)`;
      return `${message}\n--- subprocess stderr (last ~8KB) ---\n${stderr}`;
    };

    try {
      const timeoutMs = args.timeoutMs ?? 20000;
      const text = await Promise.race([
        agent.runMiniCompletion('Say ok'),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(withStderrContext(`Connection test timed out after ${timeoutMs}ms`))),
            timeoutMs
          )
        ),
      ]);

      return text
        ? { success: true }
        : { success: false, error: 'No response from provider. Check your API key.' };
    } catch (error) {
      const base = error instanceof Error ? error.message : String(error);
      // Avoid double-appending if the timeout branch already included stderr context.
      const enriched = base.includes('subprocess stderr') ? base : withStderrContext(base);
      return { success: false, error: enriched };
    } finally {
      agent.destroy();
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await cm.deleteLlmApiKey(tempSlug).catch(() => {});
  }
}
