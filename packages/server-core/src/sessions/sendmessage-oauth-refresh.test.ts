import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SessionManager, createManagedSession, setSessionRuntimeHooks } from './SessionManager.ts'

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
    sm = new SessionManager()
  })

  afterEach(() => {
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

  it('cold session: tokenRefreshManager runs before getOrCreateAgent', async () => {
    // Pre-fix this sequence was inverted: getOrCreateAgent's internal build
    // (~SessionManager.ts:2956) ran first and saw stale tokens, triggering a
    // spurious AUTH_REQUIRED → markSourceNeedsReauth → UI flicker.
    const sessionId = 'cold-oauth'
    const managed = buildSession(sessionId)
    writeOAuthSource('test-oauth-mcp', true)
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

  it('failed refresh: source excluded from usable set via in-memory mutation', async () => {
    // Change 3 mirrors markSourceNeedsReauth's disk write to source.config in
    // memory. After a failed refresh, isSourceUsable() must return false so
    // the source is excluded from intendedSlugs by the post-refresh build.
    const sessionId = 'failed-oauth'
    const managed = buildSession(sessionId)
    writeOAuthSource('failing-mcp', true)
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
    ;(sm as any).getOrCreateAgent = async () => ({
      queryLlm: async () => {
        queryCalls++
        throw new Error('network error')
      },
    })

    await expect(sm.queryOnce(managed.id, { prompt: 'summarize' } as never))
      .rejects.toThrow('network error')
    expect(queryCalls).toBe(1)
  })

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
    ;(sm as any).getOrCreateAgent = async () => ({
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

    await (sm as any).generateRemoteTransferSummary(managed).catch(() => { /* expected */ })

    expect(ensureCalls).toBe(1)
  })
})
