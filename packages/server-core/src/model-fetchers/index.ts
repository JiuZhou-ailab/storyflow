// input: Persisted LLM connections, provider credentials, and live model catalogs
// output: Deduplicated model refresh with managed-catalog reconciliation and offline fallbacks
// pos: Server-side synchronization boundary between provider metadata and stored connections

/**
 * Model Refresh Service
 *
 * Centralized service for fetching and refreshing model lists across all providers.
 * Replaces the scattered fetchAndStore*Models() functions and startCodexModelRefresh().
 *
 * Fallback chain (same for every provider):
 * 1. Provider runtime discovery via backend driver dispatch
 * 2. Persisted connection.models — previously fetched, survives offline/restart
 * 3. MODEL_REGISTRY — hardcoded offline seed data, last resort
 */

import type { ModelFetcherMap, ModelFetcherCredentials, FetchableProvider } from '@craft-agent/shared/config'
import type {
  LlmConnection,
  CustomEndpointApi,
  ModelDefinition,
  ModelThinkingLevelMap,
} from '@craft-agent/shared/config'
import type { CredentialManager } from '@craft-agent/shared/credentials'
import {
  getLlmConnections,
  getLlmConnection,
  updateLlmConnection,
  isCompatProvider,
  getModelsForProviderType,
} from '@craft-agent/shared/config'
import { MODEL_FETCHERS } from './registry'
import { handlerLog } from './runtime'

/** Copilot models are server-managed — refresh every 10 minutes to pick up policy changes. */
const COPILOT_REFRESH_INTERVAL_MS = 10 * 60 * 1000

// ============================================================
// Types
// ============================================================

type CredentialReader = Pick<CredentialManager, 'getLlmApiKey' | 'getLlmOAuth'>
type CredentialResolver = (connection: LlmConnection) => Promise<ModelFetcherCredentials>
type ManagedGatewayModel = ModelDefinition & { api: CustomEndpointApi }

function isManagedModelCatalogConnection(connection: LlmConnection): boolean {
  return connection.managed === true && connection.source === 'builtin'
}

async function fetchManagedModelCatalog(
  connection: LlmConnection,
  credentials: ModelFetcherCredentials,
): Promise<ModelDefinition[]> {
  if (!connection.baseUrl) throw new Error('Managed model gateway URL is missing')
  if (!credentials.apiKey) throw new Error('Managed model access token is missing')
  if (!connection.customEndpoint) throw new Error('Managed model protocol is missing')

  const response = await fetch(new URL('/v1/models', connection.baseUrl), {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${credentials.apiKey}`,
    },
  })
  if (!response.ok) {
    throw new Error(`Managed model catalog returned HTTP ${response.status}`)
  }

  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || !Array.isArray((body as { data?: unknown }).data)) {
    throw new Error('Managed model catalog is invalid')
  }

  const models = (body as { data: unknown[] }).data
    .map(parseManagedModelDefinition)
    .filter(model => model.api === connection.customEndpoint!.api)
    .map(({ api: _api, ...model }) => model)
  if (models.length === 0) throw new Error('Managed model catalog is empty')
  if (new Set(models.map(model => model.id)).size !== models.length) {
    throw new Error('Managed model catalog contains duplicate model IDs')
  }
  return models
}

const THINKING_LEVEL_MAP_KEYS = new Set([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])

function parseManagedThinkingLevelMap(value: unknown): ModelThinkingLevelMap | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Managed model catalog has an invalid thinking level map')
  }

  const result: Record<string, string | null> = {}
  for (const [key, effort] of Object.entries(value)) {
    if (!THINKING_LEVEL_MAP_KEYS.has(key) || (typeof effort !== 'string' && effort !== null)) {
      throw new Error('Managed model catalog has an invalid thinking level map')
    }
    result[key] = effort
  }
  return result as ModelThinkingLevelMap
}

function parseManagedModelDefinition(item: unknown): ManagedGatewayModel {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('Managed model catalog contains an invalid model')
  }

  const {
    id,
    name,
    short_name: shortName,
    description,
    provider,
    context_window: contextWindow,
    supports_thinking: supportsThinking,
    thinking_level_map: thinkingLevelMap,
    supports_images: supportsImages,
    api,
  } = item as Record<string, unknown>

  if (
    typeof id !== 'string'
    || id.trim().length === 0
    || typeof name !== 'string'
    || name.trim().length === 0
    || typeof shortName !== 'string'
    || shortName.trim().length === 0
    || typeof description !== 'string'
    || (provider !== 'pi' && provider !== 'anthropic')
    || typeof contextWindow !== 'number'
    || !Number.isSafeInteger(contextWindow)
    || contextWindow <= 0
    || typeof supportsThinking !== 'boolean'
    || typeof supportsImages !== 'boolean'
    || ![
      'openai-completions',
      'openai-responses',
      'anthropic-messages',
      'google-generative-ai',
    ].includes(api as string)
  ) {
    throw new Error('Managed model catalog contains an invalid model')
  }

  const parsedThinkingLevelMap = parseManagedThinkingLevelMap(thinkingLevelMap)
  return {
    id,
    name,
    shortName,
    description,
    provider,
    contextWindow,
    supportsThinking,
    ...(parsedThinkingLevelMap ? { thinkingLevelMap: parsedThinkingLevelMap } : {}),
    supportsImages,
    api: api as CustomEndpointApi,
  }
}

export async function resolveModelRefreshCredentials(
  connection: LlmConnection,
  manager: CredentialReader,
): Promise<ModelFetcherCredentials> {
  if (
    connection.authType === 'api_key'
    || connection.authType === 'api_key_with_endpoint'
    || connection.authType === 'bearer_token'
  ) {
    const apiKey = await manager.getLlmApiKey(connection.slug).catch(() => null)
    return { apiKey: apiKey ?? undefined }
  }

  if (connection.authType === 'oauth') {
    const oauth = await manager.getLlmOAuth(connection.slug).catch(() => null)
    return {
      oauthAccessToken: oauth?.accessToken,
      oauthRefreshToken: oauth?.refreshToken,
      oauthIdToken: oauth?.idToken,
    }
  }

  return {}
}

// ============================================================
// ModelRefreshService
// ============================================================

class ModelRefreshService {
  private timers = new Map<string, ReturnType<typeof setInterval>>()
  private inFlight = new Map<string, Promise<void>>()

  constructor(
    private fetchers: ModelFetcherMap,
    private getCredentials: CredentialResolver,
  ) {}

  /**
   * Fetch models for a connection through the fallback chain.
   * Deduplicates concurrent calls for the same slug — if a refresh is already
   * in progress, callers share the same promise instead of racing.
   */
  async refreshConnection(slug: string): Promise<void> {
    const existing = this.inFlight.get(slug)
    if (existing) return existing

    const promise = this._doRefresh(slug).finally(() => {
      this.inFlight.delete(slug)
    })
    this.inFlight.set(slug, promise)
    return promise
  }

  /**
   * Internal: actual refresh logic with fallback chain.
   * Skips user-configured compat providers (not in fetcher map).
   * Preserves user's defaultModel if still valid.
   * Updates connection.models in storage on success.
   */
  private async _doRefresh(slug: string): Promise<void> {
    const connection = getLlmConnection(slug)
    if (!connection) {
      handlerLog.warn(`Model refresh: connection not found: ${slug}`)
      return
    }

    const isManagedCatalog = isManagedModelCatalogConnection(connection)

    // User-owned compat providers configure models manually. Managed compat
    // connections are backed by the authenticated Storyflow catalog.
    if (isCompatProvider(connection.providerType) && !isManagedCatalog) {
      return
    }

    const providerType = connection.providerType as FetchableProvider
    const fetcher = this.fetchers[providerType]
    if (!isManagedCatalog && !fetcher) {
      handlerLog.warn(`Model refresh: no fetcher for provider type: ${providerType}`)
      return
    }

    let newModels: ModelDefinition[] | null = null
    let serverDefault: string | undefined

    // Layer 1: Provider API/SDK
    try {
      const credentials = await this.getCredentials(connection)
      handlerLog.info(`Model refresh [${slug}]: fetching (provider=${connection.providerType}, piAuth=${connection.piAuthProvider}, hasOAuthRefresh=${!!credentials.oauthRefreshToken}, hasOAuthAccess=${!!credentials.oauthAccessToken})`)
      if (isManagedCatalog) {
        newModels = await fetchManagedModelCatalog(connection, credentials)
      } else {
        const result = await fetcher!.fetchModels(connection, credentials)
        newModels = result.models
        serverDefault = result.serverDefault
      }
      handlerLog.info(`Model refresh [${slug}]: fetched ${newModels.length} models from provider: ${newModels.map(m => m.id).join(', ')}`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      handlerLog.warn(`Model refresh [${slug}]: provider fetch failed: ${msg}`)
    }

    // Layer 2: Persisted connection.models (keep what we have)
    if (!newModels && connection.models && connection.models.length > 0) {
      handlerLog.warn(`Model refresh [${slug}]: keeping ${connection.models.length} stale persisted models (live fetch failed)`)
      return // Nothing to update
    }

    // Layer 3: MODEL_REGISTRY hardcoded fallback
    if (!newModels) {
      const registryModels = isManagedCatalog
        ? []
        : getModelsForProviderType(providerType, connection.piAuthProvider)
      if (registryModels.length > 0) {
        newModels = registryModels
        handlerLog.info(`Model refresh [${slug}]: using ${newModels.length} models from MODEL_REGISTRY`)
      }
    }

    if (!newModels || newModels.length === 0) {
      handlerLog.warn(`Model refresh [${slug}]: no models available from any source`)
      return
    }

    // For Pi connections with explicit user-owned 3-tier selection,
    // never overwrite model lists from background refresh.
    // Exception: Copilot connections are always server-managed — GitHub's
    // model policy controls which models are enabled, so we must always
    // accept the live API result.
    const isCopilot = connection.providerType === 'pi' && connection.piAuthProvider === 'github-copilot'
    if (connection.providerType === 'pi' && connection.modelSelectionMode === 'userDefined3Tier' && !isCopilot) {
      const modelCount = connection.models?.length ?? 0
      handlerLog.info(`Model refresh [${slug}]: preserving user-defined Pi model list (${modelCount} models)`)
      if (modelCount > 10) {
        handlerLog.warn(`Model refresh [${slug}]: userDefined3Tier has suspicious model count (${modelCount})`)
      }
      return
    }

    // Preserve user's defaultModel if still valid
    const currentDefault = connection.defaultModel
    const stillValid = currentDefault && newModels.some(m => m.id === currentDefault)
    const newDefault = stillValid
      ? currentDefault
      : serverDefault ?? newModels[0]?.id

    updateLlmConnection(slug, {
      models: newModels,
      ...(newDefault && !stillValid ? { defaultModel: newDefault } : {}),
    })
  }

  /**
   * Start periodic refresh timers for all existing connections.
   * Also runs an immediate non-blocking fetch for each.
   * Call on app startup after IPC handlers are registered.
   */
  startAll(): void {
    const connections = getLlmConnections()

    for (const conn of connections) {
      if (isManagedModelCatalogConnection(conn)) {
        this.refreshConnection(conn.slug).catch(err => {
          handlerLog.warn(`Initial model refresh failed for ${conn.slug}: ${err instanceof Error ? err.message : err}`)
        })
        continue
      }
      if (isCompatProvider(conn.providerType)) continue

      const providerType = conn.providerType as FetchableProvider
      const fetcher = this.fetchers[providerType]
      if (!fetcher) continue

      // Immediate non-blocking fetch
      this.refreshConnection(conn.slug).catch(err => {
        handlerLog.warn(`Initial model refresh failed for ${conn.slug}: ${err instanceof Error ? err.message : err}`)
      })

      // Set up periodic refresh: Copilot connections get their own interval
      // (models are server-managed by GitHub policy), other providers use
      // the fetcher's generic interval (0 = no periodic refresh for static SDK models).
      const isCopilot = conn.providerType === 'pi' && conn.piAuthProvider === 'github-copilot'
      if (isCopilot) {
        this.startTimer(conn.slug, COPILOT_REFRESH_INTERVAL_MS)
      } else if (fetcher.refreshIntervalMs > 0) {
        this.startTimer(conn.slug, fetcher.refreshIntervalMs)
      }
    }
  }

  /**
   * Stop all refresh timers. Call on app quit.
   */
  stopAll(): void {
    for (const [slug, timer] of this.timers) {
      clearInterval(timer)
      handlerLog.info(`Stopped model refresh timer for ${slug}`)
    }
    this.timers.clear()
  }

  /**
   * Trigger an immediate refresh for a specific connection.
   * Also starts a periodic timer if the fetcher supports it.
   * Called when: connection created, auth completed, user clicks refresh.
   */
  async refreshNow(slug: string): Promise<void> {
    await this.refreshConnection(slug)

    // Ensure periodic timer is running
    const connection = getLlmConnection(slug)
    if (!connection || isCompatProvider(connection.providerType)) return

    const providerType = connection.providerType as FetchableProvider
    const fetcher = this.fetchers[providerType]
    const isCopilot = connection.providerType === 'pi' && connection.piAuthProvider === 'github-copilot'
    if (isCopilot && !this.timers.has(slug)) {
      this.startTimer(slug, COPILOT_REFRESH_INTERVAL_MS)
    } else if (fetcher && fetcher.refreshIntervalMs > 0 && !this.timers.has(slug)) {
      this.startTimer(slug, fetcher.refreshIntervalMs)
    }
  }

  /**
   * Stop timer for a specific connection (e.g., when deleted).
   */
  stopConnection(slug: string): void {
    const timer = this.timers.get(slug)
    if (timer) {
      clearInterval(timer)
      this.timers.delete(slug)
    }
  }

  private startTimer(slug: string, intervalMs: number): void {
    // Don't create duplicate timers
    if (this.timers.has(slug)) return

    const timer = setInterval(async () => {
      try {
        await this.refreshConnection(slug)
      } catch (err) {
        handlerLog.warn(`Periodic model refresh failed for ${slug}: ${err instanceof Error ? err.message : err}`)
      }
    }, intervalMs)

    this.timers.set(slug, timer)
  }
}

// ============================================================
// Singleton Instance
// ============================================================

let _service: ModelRefreshService | null = null

/**
 * Get the ModelRefreshService singleton.
 * Must be initialized with initModelRefreshService() before use.
 */
export function getModelRefreshService(): ModelRefreshService {
  if (!_service) {
    throw new Error('ModelRefreshService not initialized. Call initModelRefreshService() first.')
  }
  return _service
}

/**
 * Initialize the ModelRefreshService with a credential resolver.
 * Called once during app startup.
 */
export function initModelRefreshService(getCredentials: CredentialResolver): ModelRefreshService {
  _service = new ModelRefreshService(MODEL_FETCHERS, getCredentials)
  return _service
}

export { setFetcherPlatform } from './runtime'
