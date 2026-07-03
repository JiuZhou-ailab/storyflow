import { describe, it, expect } from 'bun:test'
import { getSessionsToRefreshAfterStaleReconnect } from '../reconnect-recovery'
import type { SessionMeta } from '@/atoms/sessions'

function meta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: overrides.id ?? 'session',
    workspaceId: overrides.workspaceId ?? 'workspace',
    isProcessing: overrides.isProcessing ?? false,
    ...overrides,
  }
}

describe('getSessionsToRefreshAfterStaleReconnect', () => {
  it('includes processing sessions without refreshing an already loaded active session', () => {
    const metaMap = new Map<string, SessionMeta>([
      ['active', meta({ id: 'active', messageCount: 2 })],
      ['processing', meta({ id: 'processing', isProcessing: true })],
      ['other', meta({ id: 'other' })],
    ])

    expect(getSessionsToRefreshAfterStaleReconnect(metaMap, 'active', {
      loaded: true,
      messageCount: 2,
    })).toEqual(['processing'])
  })

  it('refreshes the active session when it is not loaded or has fewer messages than metadata', () => {
    const metaMap = new Map<string, SessionMeta>([
      ['active', meta({ id: 'active', messageCount: 2 })],
    ])

    expect(getSessionsToRefreshAfterStaleReconnect(metaMap, 'active', {
      loaded: false,
      messageCount: 0,
    })).toEqual(['active'])
    expect(getSessionsToRefreshAfterStaleReconnect(metaMap, 'active', {
      loaded: true,
      messageCount: 1,
    })).toEqual(['active'])
  })

  it('deduplicates the active session when it is already processing', () => {
    const metaMap = new Map<string, SessionMeta>([
      ['active', meta({ id: 'active', isProcessing: true })],
    ])

    expect(getSessionsToRefreshAfterStaleReconnect(metaMap, 'active')).toEqual(['active'])
  })
})
