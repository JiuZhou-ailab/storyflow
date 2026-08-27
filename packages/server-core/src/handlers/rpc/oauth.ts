import { randomUUID } from 'node:crypto'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { loadSource, loadWorkspaceSources, getSourceCredentialManager } from '@craft-agent/shared/sources'
import { isFreeConversationWorkspaceId } from '@craft-agent/shared/workspaces'
import { createPendingFlow } from '@craft-agent/shared/auth'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import type { IOAuthFlowStore } from '../oauth-flow-store-interface'
import type { ISessionManager } from '../session-manager-interface'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.oauth.START,
  RPC_CHANNELS.oauth.COMPLETE,
  RPC_CHANNELS.oauth.CANCEL,
  RPC_CHANNELS.oauth.REVOKE,
] as const

/**
 * Complete an OAuth flow: validate state, exchange code for tokens, store credentials.
 *
 * Shared between the `oauth:complete` RPC handler (called by Electron) and the
 * `/api/oauth/callback` HTTP route (called by the relay for WebUI).
 *
 * @param opts.clientId - RPC client ID (for ownership validation). Omit for HTTP callback.
 * @param opts.workspaceId - Workspace ID (for ownership validation). Omit for HTTP callback.
 */
export async function completeOAuthFlow(opts: {
  code: string
  state: string
  flowStore: Pick<IOAuthFlowStore, 'getByState' | 'claim'>
  credManager: { exchangeAndStore(...args: any[]): Promise<any> }
  sessionManager: Pick<ISessionManager, 'completeAuthRequest' | 'withProjectOperation'>
  pushSourcesChanged: (workspaceId: string) => void
  logger: { info(msg: string): void; }
  clientId?: string
  workspaceId?: string | null
}): Promise<{ success: boolean; error?: string; email?: string }> {
  const { code, state, flowStore, credManager, sessionManager, pushSourcesChanged, logger } = opts

  const flow = flowStore.getByState(state)
  if (!flow) throw new Error('Unknown or expired OAuth flow')

  // When called via RPC, enforce ownership. HTTP callbacks skip this (state is sufficient auth).
  if (opts.clientId !== undefined) {
    if (flow.ownerClientId !== opts.clientId) throw new Error('OAuth flow owned by different client')
  }
  if (opts.workspaceId != null) {
    if (flow.workspaceId !== opts.workspaceId) throw new Error('Workspace mismatch')
  }

  const claimedFlow = flowStore.claim(state)
  if (!claimedFlow || claimedFlow.flowId !== flow.flowId) {
    throw new Error('OAuth flow has already been completed or cancelled')
  }

  const result = await sessionManager.withProjectOperation(claimedFlow.workspaceId, async workspace => {
    const currentSource = loadSource(
      isFreeConversationWorkspaceId(workspace.id) ? undefined : workspace.rootPath,
      claimedFlow.sourceSlug,
      workspace.id,
    )
    if (!currentSource || currentSource.definitionIdentity !== claimedFlow.source.definitionIdentity) {
      throw new Error(`Source definition changed during OAuth: ${claimedFlow.sourceSlug}`)
    }

    const exchanged = await credManager.exchangeAndStore(currentSource, claimedFlow.provider, {
      code,
      codeVerifier: claimedFlow.codeVerifier,
      tokenEndpoint: claimedFlow.tokenEndpoint,
      clientId: claimedFlow.clientId,
      clientSecret: claimedFlow.clientSecret,
      redirectUri: claimedFlow.redirectUri,
    })
    pushSourcesChanged(claimedFlow.workspaceId)
    return exchanged
  })

  // If this was triggered from a session auth card, complete it
  if (claimedFlow.sessionId && claimedFlow.authRequestId) {
    await sessionManager.completeAuthRequest(claimedFlow.sessionId, {
      requestId: claimedFlow.authRequestId,
      sourceSlug: claimedFlow.sourceSlug,
      success: result.success,
      email: result.email,
      error: result.error,
    })
  }

  logger.info(`[OAuth] Flow complete for ${claimedFlow.sourceSlug} (success=${result.success})`)
  return result
}

export async function revokeOAuthSource(opts: {
  workspaceId: string
  sourceSlug: string
  flowStore: Pick<IOAuthFlowStore, 'removeForSource'>
  credManager: {
    deleteAllStrict(source: NonNullable<ReturnType<typeof loadSource>>): Promise<void>
    markSourceRevoked(source: NonNullable<ReturnType<typeof loadSource>>): void
  }
  sessionManager: Pick<ISessionManager, 'withProjectExclusiveOperation' | 'reconcileProjectSourceGrants'>
}): Promise<ReturnType<typeof loadWorkspaceSources>> {
  const { workspaceId, sourceSlug, flowStore, credManager, sessionManager } = opts
  const sources = await sessionManager.withProjectExclusiveOperation(workspaceId, async workspace => {
    const projectRoot = isFreeConversationWorkspaceId(workspace.id) ? undefined : workspace.rootPath
    const source = loadSource(projectRoot, sourceSlug, workspace.id)
    if (!source) throw new Error(`Source not found: ${sourceSlug}`)

    flowStore.removeForSource(workspace.id, sourceSlug)
    await credManager.deleteAllStrict(source)
    credManager.markSourceRevoked(source)
    return loadWorkspaceSources(projectRoot, workspace.id)
  })
  await sessionManager.reconcileProjectSourceGrants(workspaceId)
  return sources
}

export function registerOAuthHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger
  const flowStore = deps.oauthFlowStore
  const credManager = getSourceCredentialManager()

  // ── oauth:start ──────────────────────────────────────────────
  server.handle(RPC_CHANNELS.oauth.START, async (ctx, args: {
    sourceSlug: string
    callbackPort?: number
    callbackUrl?: string
    sessionId?: string
    authRequestId?: string
  }) => {
    const { sourceSlug, callbackPort, callbackUrl, sessionId, authRequestId } = args

    if (!ctx.workspaceId) {
      throw new Error('No workspace bound to this client')
    }

    return deps.sessionManager.withProjectOperation(ctx.workspaceId, async workspace => {
      const source = loadSource(
        isFreeConversationWorkspaceId(workspace.id) ? undefined : workspace.rootPath,
        sourceSlug,
        workspace.id,
      )
      if (!source) throw new Error(`Source not found: ${sourceSlug}`)
      const prepared = await credManager.prepareOAuth(source, { callbackPort, callbackUrl })

      const flowId = randomUUID()
      flowStore.store(createPendingFlow({
        flowId,
        state: prepared.state,
        codeVerifier: prepared.codeVerifier,
        redirectUri: prepared.redirectUri,
        source,
        clientId: prepared.clientId,
        clientSecret: prepared.clientSecret,
        tokenEndpoint: prepared.tokenEndpoint,
        provider: prepared.provider,
        ownerClientId: ctx.clientId,
        workspaceId: workspace.id,
        sourceSlug,
        sessionId,
        authRequestId,
      }))

      log.info(`[OAuth] Flow started for ${sourceSlug} (flow=${flowId})`)
      return { authUrl: prepared.authUrl, state: prepared.state, flowId }
    })
  })

  // ── oauth:complete ───────────────────────────────────────────
  server.handle(RPC_CHANNELS.oauth.COMPLETE, async (ctx, args: {
    flowId: string
    code: string
    state: string
  }) => {
    const { flowId, code, state } = args

    // Validate flowId match before delegating
    const flow = flowStore.getByState(state)
    if (!flow) throw new Error('Unknown or expired OAuth flow')
    if (flow.flowId !== flowId) throw new Error('Flow ID mismatch')

    return completeOAuthFlow({
      code,
      state,
      flowStore,
      credManager,
      sessionManager: deps.sessionManager,
      pushSourcesChanged: (workspaceId) => {
        const ws = getWorkspaceByNameOrId(workspaceId)
        const sources = ws ? loadWorkspaceSources(ws.rootPath, ws.id) : []
        pushTyped(server, RPC_CHANNELS.sources.CHANGED, { to: 'workspace', workspaceId }, workspaceId, sources)
      },
      logger: log,
      clientId: ctx.clientId,
      workspaceId: ctx.workspaceId,
    })
  })

  // ── oauth:cancel ─────────────────────────────────────────────
  server.handle(RPC_CHANNELS.oauth.CANCEL, async (ctx, args: {
    flowId: string
    state: string
  }) => {
    const { flowId, state } = args
    const flow = flowStore.getByState(state)
    if (flow && flow.flowId === flowId && flow.ownerClientId === ctx.clientId) {
      flowStore.remove(state)
      log.info(`[OAuth] Flow cancelled for ${flow.sourceSlug}`)
    }
  })

  // ── oauth:revoke ─────────────────────────────────────────────
  server.handle(RPC_CHANNELS.oauth.REVOKE, async (ctx, args: {
    sourceSlug: string
  }) => {
    const { sourceSlug } = args

    if (!ctx.workspaceId) {
      throw new Error('No workspace bound to this client')
    }

    const revokeSources = await revokeOAuthSource({
      workspaceId: ctx.workspaceId,
      sourceSlug,
      flowStore,
      credManager,
      sessionManager: deps.sessionManager,
    })

    pushTyped(server, RPC_CHANNELS.sources.CHANGED, { to: 'workspace', workspaceId: ctx.workspaceId }, ctx.workspaceId, revokeSources)

    log.info(`[OAuth] Revoked credentials for ${sourceSlug}`)
    return { success: true }
  })
}
