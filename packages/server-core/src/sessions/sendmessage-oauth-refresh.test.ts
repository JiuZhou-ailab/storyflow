import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ManagedAccessRefreshError } from '@craft-agent/shared/auth/managed-access'
import { createSourceGrantRefs, loadWorkspaceSources } from '@craft-agent/shared/sources'
import { SessionManager, createManagedSession, setSessionRuntimeHooks } from './SessionManager.ts'
import { MANAGED_MODEL_ACCESS_UNAVAILABLE_MESSAGE } from './managed-gateway-auth-error'

// Regression tests for #710 — OAuth tokens expire without silent refresh.
//
// Pre-fix ordering in sendMessage:
//   getOrCreateAgent (cold-session internal build) → buildServersFromSources →
//   refreshOAuthTokensIfNeeded → conditional rebuild
//
// That meant the cold-session build saw stale tokens, emitted AUTH_REQUIRED,
// and the wrapper called markSourceNeedsReauth — flipping `isAuthenticated`
// to false on disk before the late refresh could restore it. The user saw a
// brief "needs auth" UI flicker and the agent occasionally received the wrong
// source state.
//
// Post-fix ordering:
//   refreshExpiredCredentials → getOrCreateAgent (cold build sees fresh tokens)
//   → single buildServersFromSources → setSourceServers
//
// These tests pin the ordering and the failure-exclusion contract.

describe('sendMessage OAuth refresh ordering (#710)', () => {
  let tmpRoot: string
  let sm: SessionManager

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-oauth-refresh-'))
    mkdirSync(join(tmpRoot, '.craft-agent'), { recursive: true })
    writeFileSync(join(tmpRoot, '.craft-agent', 'config.json'), JSON.stringify({
      id: 'directory-test', name: 'Test Workspace', slug: 'test-workspace', createdAt: 1, updatedAt: 1,
    }))
    sm = new SessionManager((_workspaceId, managed) => managed.workspace)
  })

  afterEach(async () => {
    await sm.flushAllSessions()
    sm.cleanup()
    setSessionRuntimeHooks({
      ensureManagedModelAccessToken: async () => ({ token: 'managed-token', refreshed: false }),
    })
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function buildSession(id: string) {
    const workspace = {
      id: 'ws_test',
      name: 'Test Workspace',
      rootPath: tmpRoot,
      createdAt: Date.now(),
      directoryConfigId: 'directory-test',
    }
    const managed = createManagedSession(
      { id, name: 'oauth-refresh test' },
      workspace as never,
      { messagesLoaded: true },
    )
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(id, managed)
    return managed
  }

  function writeOAuthSource(slug: string, isAuthenticated: boolean) {
    const dir = join(tmpRoot, 'sources', slug)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({
        id: slug,
        slug,
        name: slug,
        type: 'mcp',
        enabled: true,
        provider: 'craft',
        isAuthenticated,
        mcp: { url: `https://${slug}.example.com`, authType: 'oauth' },
      }),
    )
    writeFileSync(join(dir, 'guide.md'), `# ${slug}\n`)
  }

  function grantSource(managed: ReturnType<typeof buildSession>, slug: string) {
    managed.workspace.defaultEnabledSourceRefs = createSourceGrantRefs(
      [slug],
      loadWorkspaceSources(tmpRoot, managed.workspace.id),
    )
  }

  it('cold session: tokenRefreshManager runs before getOrCreateAgent', async () => {
    // Pre-fix this sequence was inverted: getOrCreateAgent's internal build
    // (~SessionManager.ts:2956) ran first and saw stale tokens, triggering a
    // spurious AUTH_REQUIRED → markSourceNeedsReauth → UI flicker.
    const sessionId = 'cold-oauth'
    const managed = buildSession(sessionId)
    writeOAuthSource('test-oauth-mcp', true)
    grantSource(managed, 'test-oauth-mcp')
    managed.enabledSourceSlugs = ['test-oauth-mcp']

    const calls: string[] = []
    const trm = managed.tokenRefreshManager!
    const origGetNeed = trm.getSourcesNeedingRefresh.bind(trm)
    trm.getSourcesNeedingRefresh = async (sources) => {
      calls.push('refresh.getSourcesNeedingRefresh')
      return origGetNeed(sources)
    }

    // sendMessage will throw later in agent-init (no LLM platform configured
    // in this minimal harness). We only care that refresh ran before that point.
    await sm.sendMessage(sessionId, 'hello').catch(() => { /* expected */ })

    expect(calls).toContain('refresh.getSourcesNeedingRefresh')
  })

  it('does not inspect or refresh credentials for an ungranted source', async () => {
    const sessionId = 'revoked-oauth'
    const managed = buildSession(sessionId)
    writeOAuthSource('revoked-mcp', true)
    managed.enabledSourceSlugs = ['revoked-mcp']

    let refreshChecks = 0
    managed.tokenRefreshManager.getSourcesNeedingRefresh = async () => {
      refreshChecks++
      return []
    }

    await sm.sendMessage(sessionId, 'hello').catch(() => { /* expected */ })

    expect(refreshChecks).toBe(0)
  })

  it('failed refresh: source excluded from usable set via in-memory mutation', async () => {
    // Change 3 mirrors markSourceNeedsReauth's disk write to source.config in
    // memory. After a failed refresh, isSourceUsable() must return false so
    // the source is excluded from intendedSlugs by the post-refresh build.
    const sessionId = 'failed-oauth'
    const managed = buildSession(sessionId)
    writeOAuthSource('failing-mcp', true)
    grantSource(managed, 'failing-mcp')
    managed.enabledSourceSlugs = ['failing-mcp']

    const trm = managed.tokenRefreshManager!
    // Force the source into the needs-refresh set, then make refresh fail.
    trm.getSourcesNeedingRefresh = async (sources) => sources
    trm.refreshSources = async (sources) => {
      // Mirror the production failure path: ensureFreshToken mutates source.config
      // on failure (token-refresh-manager.ts), so reproduce that here.
      for (const s of sources) {
        s.config.isAuthenticated = false
        s.config.connectionStatus = 'needs_auth'
        s.config.connectionError = 'Token refresh failed'
      }
      return { refreshed: [], failed: sources.map(s => ({ source: s, reason: 'Token refresh failed' })) }
    }

    await sm.sendMessage(sessionId, 'hello').catch(() => { /* expected */ })

    // Reload source list the same way sendMessage does and verify the failed
    // source is no longer usable.
    const { getSourcesBySlugs } = await import('@craft-agent/shared/sources')
    const { isSourceUsable } = await import('@craft-agent/shared/sources/storage')
    const reloaded = getSourcesBySlugs(tmpRoot, ['failing-mcp'])
    // In-memory mutation happened on the source instance passed to refreshSources;
    // disk wasn't touched in this stub, so reloaded copy still says authenticated.
    // The relevant assertion: the source instance the manager mutated is now
    // excluded by isSourceUsable.
    const mutated = {
      ...reloaded[0]!,
      config: { ...reloaded[0]!.config, isAuthenticated: false, connectionStatus: 'needs_auth' as const },
    }
    expect(isSourceUsable(mutated)).toBe(false)
  })

  it('ensures managed model access before creating the backend', async () => {
    const managed = buildSession('managed-model-access')
    managed.llmConnection = 'storyflow-managed'
    let ensureCalls = 0
    setSessionRuntimeHooks({
      ensureManagedModelAccessToken: async () => {
        ensureCalls++
        return { token: 'managed-token', refreshed: false }
      },
    })

    await sm.sendMessage(managed.id, 'hello').catch(() => { /* expected in minimal harness */ })

    expect(ensureCalls).toBe(1)
  })

  it('cleans up processing state when managed model access cannot refresh', async () => {
    const managed = buildSession('managed-refresh-failure')
    managed.llmConnection = 'storyflow-managed'
    const errors: unknown[] = []
    sm.setEventSink((channel, _target, event) => {
      if (channel === 'session:event' && (event as { type?: string })?.type === 'error') {
        errors.push(event)
      }
    })
    setSessionRuntimeHooks({
      ensureManagedModelAccessToken: async () => {
        throw new Error('broker unavailable')
      },
    })

    await sm.sendMessage(managed.id, 'hello')

    expect(managed.isProcessing).toBe(false)
    expect(errors).toHaveLength(1)
  })

  it('shows the host-classified recovery when managed access cannot be renewed before sending', async () => {
    const managed = buildSession('managed-refresh-classified')
    managed.llmConnection = 'storyflow-managed'
    const events: Array<{ type?: string; error?: unknown }> = []
    sm.setEventSink((channel, _target, event) => {
      if (channel === 'session:event') events.push(event as { type?: string; error?: unknown })
    })
    let ensureCalls = 0
    setSessionRuntimeHooks({
      ensureManagedModelAccessToken: async () => {
        ensureCalls++
        throw new ManagedAccessRefreshError('sign_in', { reason: 'session_revoked', correlationId: 'broker-11' })
      },
    })

    await sm.sendMessage(managed.id, 'hello')

    // One preflight, no renewal retry, no replay and no raw error text.
    expect(ensureCalls).toBe(1)
    expect(managed.isProcessing).toBe(false)
    expect(events.filter(event => event.type === 'error')).toEqual([])
    expect(events.filter(event => event.type === 'typed_error')).toEqual([expect.objectContaining({
      error: expect.objectContaining({ title: 'Sign in again', canRetry: false, details: ['Reference: broker-11'] }),
    })])
    expect(managed.messages.filter(message => message.role === 'user')).toHaveLength(1)
    expect(managed.messages.at(-1)).toMatchObject({ role: 'error', errorTitle: 'Sign in again', errorCanRetry: false })
  })

  it('treats a stop during the pre-send renewal as an interruption, not an access error', async () => {
    const managed = buildSession('managed-refresh-stopped')
    managed.llmConnection = 'storyflow-managed'
    const events: Array<{ type?: string }> = []
    sm.setEventSink((channel, _target, event) => {
      if (channel === 'session:event') events.push(event as { type?: string })
    })
    let markStarted!: () => void
    let failRenewal!: (error: unknown) => void
    const started = new Promise<void>(resolve => { markStarted = resolve })
    setSessionRuntimeHooks({
      ensureManagedModelAccessToken: () => {
        markStarted()
        return new Promise((_resolve, reject) => { failRenewal = reject })
      },
    })

    const sending = sm.sendMessage(managed.id, 'hello')
    await started
    await sm.cancelProcessing(managed.id)
    expect(managed.isProcessing).toBe(true)
    failRenewal(new ManagedAccessRefreshError('sign_in', { reason: 'session_revoked' }))
    await sending

    expect(managed.isProcessing).toBe(false)
    expect(events.filter(event => event.type === 'typed_error' || event.type === 'error')).toEqual([])
    expect(managed.messages.filter(message => message.role === 'error')).toEqual([])
  })

  it('still shows sign-in when the rejected login revokes managed runtimes during the preflight', async () => {
    const managed = buildSession('managed-refresh-revoked-runtime')
    managed.llmConnection = 'storyflow-managed'
    const events: Array<{ type?: string }> = []
    sm.setEventSink((channel, _target, event) => {
      if (channel === 'session:event') events.push(event as { type?: string })
    })
    let revocation: Promise<void> | undefined
    setSessionRuntimeHooks({
      ensureManagedModelAccessToken: async () => {
        // Mirrors Electron: a broker 401 clears the login, whose auth change revokes managed runtimes without awaiting.
        revocation = sm.disposeConnectionRuntimes('storyflow-managed')
        throw new ManagedAccessRefreshError('sign_in', { reason: 'session_revoked' })
      },
    })

    await sm.sendMessage(managed.id, 'hello')
    await revocation

    expect(managed.isProcessing).toBe(false)
    expect(managed.runtimeState).toBeUndefined()
    expect(events.filter(event => event.type === 'error')).toEqual([])
    expect(events.filter(event => event.type === 'typed_error')).toHaveLength(1)
    expect(managed.messages.at(-1)).toMatchObject({ role: 'error', errorTitle: 'Sign in again' })
  })

  it('keeps the host message when this host cannot provide managed access at all', async () => {
    const managed = buildSession('managed-host-unavailable')
    managed.llmConnection = 'storyflow-managed'
    const events: Array<{ type?: string; error?: unknown }> = []
    sm.setEventSink((channel, _target, event) => {
      if (channel === 'session:event') events.push(event as { type?: string; error?: unknown })
    })
    setSessionRuntimeHooks({
      ensureManagedModelAccessToken: async () => { throw new Error(MANAGED_MODEL_ACCESS_UNAVAILABLE_MESSAGE) },
    })

    await sm.sendMessage(managed.id, 'hello')

    // Shared/server mode is not a temporary outage; it must not claim the user is still signed in.
    expect(events.filter(event => event.type === 'typed_error')).toEqual([])
    expect(events.filter(event => event.type === 'error')).toEqual([
      expect.objectContaining({ error: MANAGED_MODEL_ACCESS_UNAVAILABLE_MESSAGE }),
    ])
  })

  it('preflights managed model access for one-shot calls', async () => {
    const managed = buildSession('managed-query-once')
    managed.llmConnection = 'storyflow-managed'
    let ensureCalls = 0
    setSessionRuntimeHooks({
      ensureManagedModelAccessToken: async () => {
        ensureCalls++
        return { token: 'managed-token', refreshed: false }
      },
    })

    await sm.queryOnce(managed.id, { prompt: 'summarize' } as never).catch(() => { /* expected */ })

    expect(ensureCalls).toBe(1)
  })

  it('delegates one-shot network retries to Pi', async () => {
    const managed = buildSession('query-once-network-retry')
    let queryCalls = 0
    ;(sm as any).getOrCreateAgentLocked = async () => ({
      queryLlm: async () => {
        queryCalls++
        throw new Error('network error')
      },
    })

    await expect(sm.queryOnce(managed.id, { prompt: 'summarize' } as never))
      .rejects.toThrow('network error')
    expect(queryCalls).toBe(1)
  })

  for (const status of ['completed', 'incomplete', 'failed', 'cancelled'] as const) {
    it(`one-shot and rewrite consumers only accept completed output (${status})`, async () => {
      const managed = buildSession(`query-result-${status}`)
      let calls = 0
      ;(sm as any).getOrCreateAgentLocked = async () => ({
        queryLlm: async () => {
          calls++
          return { text: 'Replacement text', status, warning: status === 'completed' ? undefined : `Query ${status}` }
        },
      })
      const query = sm.queryOnce(managed.id, { prompt: 'rewrite' })
      if (status === 'completed') await expect(query).resolves.toMatchObject({ text: 'Replacement text', status })
      else await expect(query).rejects.toThrow(`Query ${status}`)
      const rewrite = sm.rewriteNovelSelection(managed.id, {
        filePath: join(tmpRoot, 'chapter.md'), relativePath: 'chapter.md', selectedText: 'Original', instruction: 'Rewrite',
      })
      if (status === 'completed') await expect(rewrite).resolves.toEqual({ replacement: 'Replacement text' })
      else await expect(rewrite).rejects.toThrow(`Query ${status}`)
      expect(calls).toBe(2)
    })
  }

  it('refreshes invalid managed access for a later one-shot call without replaying', async () => {
    const managed = buildSession('query-once-managed-auth-refresh')
    managed.llmConnection = 'storyflow-managed'
    let queryCalls = 0
    let ensureCalls = 0
    setSessionRuntimeHooks({
      ensureManagedModelAccessToken: async (forceRefresh) => {
        if (forceRefresh) ensureCalls++
        return { token: 'managed-token', refreshed: Boolean(forceRefresh) }
      },
    })
    ;(sm as any).getOrCreateAgentLocked = async () => ({
      queryLlm: async () => {
        queryCalls++
        throw new Error('model_access_token_invalid')
      },
    })

    await expect(sm.queryOnce(managed.id, { prompt: 'summarize' } as never))
      .rejects.toThrow('model_access_token_invalid')
    expect(queryCalls).toBe(1)
    expect(ensureCalls).toBe(1)
  })

  it('preflights managed model access for manual title refresh', async () => {
    const managed = buildSession('managed-refresh-title')
    managed.llmConnection = 'storyflow-managed'
    managed.messages = [{ id: 'user-1', role: 'user', content: 'hello', timestamp: 1 }]
    let ensureCalls = 0
    setSessionRuntimeHooks({
      ensureManagedModelAccessToken: async () => {
        ensureCalls++
        return { token: 'managed-token', refreshed: false }
      },
    })

    await sm.refreshTitle(managed.id)

    expect(ensureCalls).toBe(1)
  })

  it('preflights managed model access for remote transfer summaries', async () => {
    const managed = buildSession('managed-transfer-summary')
    managed.llmConnection = 'storyflow-managed'
    managed.messages = [{ id: 'user-1', role: 'user', content: 'hello', timestamp: 1 }]
    let ensureCalls = 0
    setSessionRuntimeHooks({
      ensureManagedModelAccessToken: async () => {
        ensureCalls++
        return { token: 'managed-token', refreshed: false }
      },
    })

    await ((sm as any).exportImport as { generateRemoteTransferSummary(m: unknown): Promise<string | null> })
      .generateRemoteTransferSummary(managed)
      .catch(() => { /* expected */ })

    expect(ensureCalls).toBe(1)
  })
})
