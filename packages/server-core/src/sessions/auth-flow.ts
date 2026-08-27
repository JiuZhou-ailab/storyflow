// input: Session lookups, persistence, runtime-lock and send-message callbacks, credential manager, source registry
// output: Auth request completion, credential input handling, auth message formatting, and process env re-initialization
// pos: Auth subdomain under the SessionManager facade; sendMessage/withAgentRuntimeLock stay in the Facade via injected callbacks

import type { AuthRequest, AuthResult, CredentialAuthRequest } from '@craft-agent/shared/agent'
import {
  getDefaultLlmConnection,
  getLlmConnection,
  resetManagedAnthropicAuthEnvVars,
  resolveAuthEnvVars,
} from '@craft-agent/shared/config'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import {
  getSourceCredentialManager,
  isSourceHostGranted,
  isSourceUsable,
  loadAllSources,
  loadSource,
} from '@craft-agent/shared/sources'
import { getSessionPath as getSessionStoragePath } from '@craft-agent/shared/sessions'
import { isFreeConversationWorkspaceId } from '@craft-agent/shared/workspaces'
import type { SessionEvent } from '@craft-agent/shared/protocol'
import { buildServersFromSources } from './source-bridge'
import { getResourceProjectRoot, getSessionLog } from './session-runtime'
import type { ManagedSession } from './managed-session'

export interface AuthFlowDeps {
  /** Registry lookup — identity-checked by callers via the shared sessions map. */
  getSession: (sessionId: string) => ManagedSession | undefined
  sendEvent: (event: SessionEvent, workspaceId?: string) => void
  persistSession: (managed: ManagedSession) => void
  withAgentRuntimeLock: <T>(managed: ManagedSession, work: () => Promise<T>, allowClosing?: boolean) => Promise<T>
  sendMessage: (
    sessionId: string,
    message: string,
    attachments?: import('@craft-agent/shared/protocol').FileAttachment[],
    storedAttachments?: import('@craft-agent/core/types').StoredAttachment[],
    options?: import('@craft-agent/shared/protocol').SendMessageOptions,
    existingMessageId?: string,
  ) => Promise<unknown>
}

export class AuthFlow {
  constructor(private deps: AuthFlowDeps) {}

  /**
   * Reinitialize authentication environment variables.
   *
   * Uses the default LLM connection to determine which credentials to set.
   *
   * @param connectionSlug - Optional connection slug to use (overrides default)
   */
  async reinitializeAuth(connectionSlug?: string): Promise<void> {
    try {
      const manager = getCredentialManager()

      // Get the connection to use (explicit parameter or default)
      const slug = connectionSlug || getDefaultLlmConnection()
      if (!slug) {
        getSessionLog().warn('No LLM connection slug available for reinitializeAuth')
      }
      const connection = slug ? getLlmConnection(slug) : null

      // Restore managed auth env vars to their baseline before applying this connection.
      resetManagedAnthropicAuthEnvVars()

      if (!connection) {
        getSessionLog().error(`No LLM connection found for slug: ${slug}`)
        return
      }

      getSessionLog().info(`Reinitializing auth for connection: ${slug} (${connection.authType})`)

      // Resolve auth env vars via shared utility (provider-agnostic)
      const result = await resolveAuthEnvVars(connection, slug!, manager)

      if (!result.success) {
        getSessionLog().error(`Auth resolution failed for ${slug}: ${result.warning}`)
      } else {
        // Apply resolved env vars to process.env
        for (const [key, value] of Object.entries(result.envVars)) {
          process.env[key] = value
        }
        getSessionLog().info(`Auth env vars set for connection: ${slug}`)
      }
    } catch (error) {
      getSessionLog().error('Failed to reinitialize auth:', error)
      throw error
    }
  }

  /**
   * Get human-readable description for auth request
   */
  getAuthRequestDescription(request: AuthRequest): string {
    switch (request.type) {
      case 'credential':
        return `Authentication required for ${request.sourceName}`
      case 'oauth':
        return `OAuth authentication for ${request.sourceName}`
      case 'oauth-google':
        return `Sign in with Google for ${request.sourceName}`
      case 'oauth-slack':
        return `Sign in with Slack for ${request.sourceName}`
      case 'oauth-microsoft':
        return `Sign in with Microsoft for ${request.sourceName}`
    }
  }

  /**
   * Format auth result message to send back to agent
   */
  private formatAuthResultMessage(result: AuthResult): string {
    if (result.success) {
      let msg = `Authentication completed for ${result.sourceSlug}.`
      if (result.email) msg += ` Signed in as ${result.email}.`
      if (result.workspace) msg += ` Connected to workspace: ${result.workspace}.`
      msg += ' Credentials have been saved.'
      return msg
    }
    if (result.cancelled) {
      return `Authentication cancelled for ${result.sourceSlug}.`
    }
    return `Authentication failed for ${result.sourceSlug}: ${result.error || 'Unknown error'}`
  }


  /**
   * Complete an auth request and send result back to agent
   * This updates the auth message status and sends a faked user message
   */
  async completeAuthRequest(sessionId: string, result: AuthResult): Promise<void> {
    const managed = this.deps.getSession(sessionId)
    if (!managed) {
      getSessionLog().warn(`Cannot complete auth request - session ${sessionId} not found`)
      return
    }

    // Find and update the pending auth-request message
    const authMessage = managed.messages.find(m =>
      m.role === 'auth-request' &&
      m.authRequestId === result.requestId &&
      m.authStatus === 'pending'
    )

    if (authMessage) {
      authMessage.authStatus = result.success ? 'completed' :
                               result.cancelled ? 'cancelled' : 'failed'
      authMessage.authError = result.error
      authMessage.authEmail = result.email
      authMessage.authWorkspace = result.workspace
    }

    // Emit auth_completed event to update UI
    this.deps.sendEvent({
      type: 'auth_completed',
      sessionId,
      requestId: result.requestId,
      success: result.success,
      cancelled: result.cancelled,
      error: result.error,
    }, managed.workspace.id)

    // Create faked user message with result
    const resultContent = this.formatAuthResultMessage(result)

    // Clear pending auth state
    managed.pendingAuthRequestId = undefined
    managed.pendingAuthRequest = undefined

    // Auto-enable the source in the session after successful auth
    if (result.success && result.sourceSlug) {
      const slugSet = new Set(managed.enabledSourceSlugs || [])
      if (!slugSet.has(result.sourceSlug)) {
        slugSet.add(result.sourceSlug)
        managed.enabledSourceSlugs = Array.from(slugSet)
        getSessionLog().info(`Auto-enabled source ${result.sourceSlug} in session ${sessionId} after auth`)
      }

      // Clear any refresh cooldown so the source is immediately usable
      managed.tokenRefreshManager.clearCooldown(result.sourceSlug)
    }

    // Persist session with updated auth message and enabled sources
    this.deps.persistSession(managed)

    // Update source runtime config/credentials for backends that need it
    if (result.success && result.sourceSlug) {
      const workspaceRootPath = managed.workspace.rootPath
      const sessionPath = getSessionStoragePath(workspaceRootPath, managed.id)
      const enabledSlugs = managed.enabledSourceSlugs || []
      const allSources = loadAllSources(
        getResourceProjectRoot(managed.workspace),
        managed.workspace.id,
      )
      const enabledSources = allSources.filter(s =>
        enabledSlugs.includes(s.config.slug) && isSourceUsable(s)
      )
      const { mcpServers, resolvedSources } = await buildServersFromSources(
        enabledSources,
        sessionPath,
        managed.tokenRefreshManager,
        undefined,
        managed.workspace,
      )
      await this.deps.withAgentRuntimeLock(managed, async () => {
        if (!managed.agent) return
        await managed.agent.applyBridgeUpdates({ sessionPath, enabledSources: resolvedSources, mcpServers, sessionId: managed.id, workspaceRootPath, context: 'source auth' })
      })
    }

    // Send the result as a new message to resume conversation
    // Use empty arrays for attachments since this is a system-generated message
    await this.deps.sendMessage(sessionId, resultContent, [], [], {})

    getSessionLog().info(`Auth request completed for ${result.sourceSlug}: ${result.success ? 'success' : 'failed'}`)
  }

  /**
   * Handle credential input from the UI (for non-OAuth auth)
   * Called when user submits credentials via the inline form
   */
  async handleCredentialInput(
    sessionId: string,
    requestId: string,
    response: import('@craft-agent/shared/protocol').CredentialResponse
  ): Promise<void> {
    const managed = this.deps.getSession(sessionId)
    if (!managed?.pendingAuthRequest) {
      getSessionLog().warn(`Cannot handle credential input - no pending auth request for session ${sessionId}`)
      return
    }

    const request = managed.pendingAuthRequest as CredentialAuthRequest
    if (request.requestId !== requestId) {
      getSessionLog().warn(`Credential request ID mismatch: expected ${request.requestId}, got ${requestId}`)
      return
    }

    if (response.cancelled) {
      await this.completeAuthRequest(sessionId, {
        requestId,
        sourceSlug: request.sourceSlug,
        success: false,
        cancelled: true,
      })
      return
    }

    try {
      const source = loadSource(
        getResourceProjectRoot(managed.workspace),
        request.sourceSlug,
        managed.workspace.id,
      )
      if (!source) throw new Error(`Source not found: ${request.sourceSlug}`)
      if (
        !isFreeConversationWorkspaceId(managed.workspace.id)
        && !isSourceHostGranted(managed.workspace.defaultEnabledSourceRefs, source)
      ) {
        throw new Error(`Source '${request.sourceSlug}' is not enabled by Host settings.`)
      }

      const value = request.mode === 'basic'
        ? JSON.stringify({ username: response.username, password: response.password })
        : request.mode === 'multi-header'
          ? JSON.stringify(response.headers)
          : response.value!
      const credentialManager = getSourceCredentialManager()
      await credentialManager.save(source, { value })
      credentialManager.markSourceAuthenticated(source)

      // Mark source as unseen so fresh guide is injected on next message
      if (managed.agent) {
        managed.agent.markSourceUnseen(request.sourceSlug)
      }

      await this.completeAuthRequest(sessionId, {
        requestId,
        sourceSlug: request.sourceSlug,
        success: true,
      })
    } catch (error) {
      getSessionLog().error(`Failed to save credentials for ${request.sourceSlug}:`, error)
      await this.completeAuthRequest(sessionId, {
        requestId,
        sourceSlug: request.sourceSlug,
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save credentials',
      })
    }
  }
}
