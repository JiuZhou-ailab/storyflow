// input: Loaded sources, credential managers, Host workspace grants, and the server builder
// output: MCP/API server construction from sources (buildServersFromSources)
// pos: Shared leaf under the SessionManager facade; used by source reload (Facade) and auth flow

import { perf } from '@craft-agent/shared/utils'
import type { Workspace } from '@craft-agent/shared/config'
import { isFreeConversationWorkspaceId, isLocalMcpEnabled, resolveRuntimeWorkspace } from '@craft-agent/shared/workspaces'
import {
  getSourceCredentialManager,
  getSourceServerBuilder,
  type LoadedSource,
  type SourceWithCredential,
  type SummarizeCallback,
  isApiOAuthProvider,
  hasRenewEndpoint,
  SERVER_BUILD_ERRORS,
  TokenRefreshManager,
  createTokenGetter,
  createStoryflowManagedTokenGetter,
  getTrustedManagedSourcePolicy,
  isSourceHostGranted,
} from '@craft-agent/shared/sources'
import { getSessionLog } from './session-runtime'

export async function buildServersFromSources(
  sources: LoadedSource[],
  sessionPath?: string,
  tokenRefreshManager?: TokenRefreshManager,
  summarize?: SummarizeCallback,
  workspace?: Pick<Workspace, 'id' | 'rootPath' | 'localMcpEnabled' | 'defaultEnabledSourceRefs'>,
) {
  const currentWorkspace = workspace && !isFreeConversationWorkspaceId(workspace.id)
    ? resolveRuntimeWorkspace(workspace.id) ?? workspace
    : workspace
  const resolvedSources = currentWorkspace && !isFreeConversationWorkspaceId(currentWorkspace.id)
    ? sources.filter(source => isSourceHostGranted(currentWorkspace.defaultEnabledSourceRefs, source))
    : sources
  const span = perf.span('sources.buildServers', { count: resolvedSources.length })
  const credManager = getSourceCredentialManager()
  const serverBuilder = getSourceServerBuilder()

  // Load credentials for all sources
  const sourcesWithCreds: SourceWithCredential[] = await Promise.all(
    resolvedSources.map(async (source) => source.config.api?.authType === 'managed'
      ? { source, token: null, credential: null }
      : {
          source,
          token: await credManager.getToken(source),
          credential: await credManager.getApiCredential(source),
        })
  )
  span.mark('credentials.loaded')

  // Build token getter for refreshable sources (OAuth + renew-endpoint)
  // Uses TokenRefreshManager for unified refresh logic (DRY principle)
  const getTokenForSource = (source: LoadedSource) => {
    const provider = source.config.provider
    if (source.config.api?.authType === 'managed') {
      const policy = getTrustedManagedSourcePolicy(source)
      return createStoryflowManagedTokenGetter({
        expectedGatewayBaseUrl: policy.gatewayBaseUrl,
      })
    }
    // Provider-specific OAuth (Google, Slack, Microsoft) or generic OAuth (authType: 'oauth')
    if (isApiOAuthProvider(provider) || source.config.api?.authType === 'oauth') {
      const manager = tokenRefreshManager ?? new TokenRefreshManager(credManager, {
        log: (msg) => getSessionLog().debug(msg),
      })
      return createTokenGetter(manager, source)
    }
    // API renew endpoint — non-OAuth token refresh
    if (hasRenewEndpoint(source)) {
      const manager = tokenRefreshManager ?? new TokenRefreshManager(credManager, {
        log: (msg) => getSessionLog().debug(msg),
      })
      return createTokenGetter(manager, source)
    }
    return undefined
  }

  // Pass sessionPath to enable saving large API responses to session folder
  const allowProjectStdio = currentWorkspace
    ? isLocalMcpEnabled(currentWorkspace.rootPath, currentWorkspace.localMcpEnabled)
    : false
  const result = await serverBuilder.buildAll(
    sourcesWithCreds,
    getTokenForSource,
    sessionPath,
    summarize,
    { allowProjectStdio },
  )
  span.mark('servers.built')
  span.setMetadata('mcpCount', Object.keys(result.mcpServers).length)
  span.setMetadata('apiCount', Object.keys(result.apiServers).length)

  // Update source configs for auth errors so UI reflects actual state.
  // Re-classify AUTH_REQUIRED → TOKEN_EXPIRED when the credential is merely
  // expired-but-refreshable; in that case the refresh cycle handles recovery
  // and we must NOT prematurely mark the source as needing re-auth (#710).
  for (const error of result.errors) {
    if (error.error !== SERVER_BUILD_ERRORS.AUTH_REQUIRED) continue
    const source = resolvedSources.find(s => s.config.slug === error.sourceSlug)
    if (!source) continue

    const cred = await credManager.load(source)
    const isExpiredRefreshable =
      cred &&
      (credManager.isExpired(cred) || credManager.needsRefresh(cred)) &&
      (cred.refreshToken || hasRenewEndpoint(source))

    if (isExpiredRefreshable) {
      error.error = SERVER_BUILD_ERRORS.TOKEN_EXPIRED
      getSessionLog().debug(`Source ${error.sourceSlug}: TOKEN_EXPIRED — refresh cycle will handle`)
      continue
    }

    credManager.markSourceNeedsReauth(source, 'Token missing or expired')
    getSessionLog().info(`Marked source ${error.sourceSlug} as needing re-auth`)
  }

  span.end()
  return { ...result, resolvedSources }
}
