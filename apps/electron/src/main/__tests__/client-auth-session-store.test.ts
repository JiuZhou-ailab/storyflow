// input: Fake credential manager records for desktop client auth sessions
// output: Regression coverage for encrypted session-store adapter behavior
// pos: Guards restart auth persistence without depending on the real credential backend

import { describe, expect, it } from 'bun:test'
import type { StoredCredential } from '@craft-agent/shared/credentials'
import { createClientAuthSessionStore } from '../client-auth-session-store'

function modelToken(exp: number): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'),
    Buffer.from(JSON.stringify({ exp })).toString('base64url'),
    'signature',
  ].join('.')
}

describe('createClientAuthSessionStore', () => {
  it('saves, restores, and clears the desktop session and managed model token together', async () => {
    const records = new Map<string, StoredCredential>()
    const keyFor = (id: unknown) => JSON.stringify(id)
    const store = createClientAuthSessionStore({
      get: async (id) => records.get(keyFor(id)) ?? null,
      set: async (id, credential) => {
        records.set(keyFor(id), credential)
      },
      delete: async (id) => {
        return records.delete(keyFor(id))
      },
    })

    const token = modelToken(Math.floor(Date.now() / 1000) + 3600)
    await store.save({
      user: {
        provider: 'feishu',
        userId: 'ou_user',
        email: 'USER@example.com',
        name: 'User',
      },
      appSessionToken: 'app-session-token',
      modelAccessToken: token,
    })

    expect(records.get(keyFor({
      type: 'llm_api_key',
      connectionSlug: 'wangsu-default',
    }))).toEqual({ value: token })
    expect(await store.load()).toEqual({
      user: {
        provider: 'feishu',
        userId: 'ou_user',
        email: 'user@example.com',
        name: 'User',
      },
      appSessionToken: 'app-session-token',
      modelAccessToken: token,
    })

    await store.clear()

    expect(records.size).toBe(0)
    expect(await store.load()).toBeNull()
  })

  it('ignores malformed persisted sessions and removes stale managed credentials', async () => {
    let managedCredentialDeleted = false
    const store = createClientAuthSessionStore({
      get: async () => ({ value: JSON.stringify({ user: { provider: 'neon' } }) }),
      set: async () => {},
      delete: async (id) => {
        if (id.type === 'llm_api_key') managedCredentialDeleted = true
        return false
      },
    })

    expect(await store.load()).toBeNull()
    expect(managedCredentialDeleted).toBe(true)
  })

  it('clears an expired model token instead of restoring an unusable session', async () => {
    const records = new Map<string, StoredCredential>()
    const keyFor = (id: unknown) => JSON.stringify(id)
    records.set(keyFor({ type: 'client_auth_session' }), {
      value: JSON.stringify({
        user: { provider: 'neon', userId: 'user-1' },
        modelAccessToken: modelToken(Math.floor(Date.now() / 1000) - 1),
      }),
    })
    records.set(keyFor({ type: 'llm_api_key', connectionSlug: 'wangsu-default' }), {
      value: 'expired',
    })
    const store = createClientAuthSessionStore({
      get: async (id) => records.get(keyFor(id)) ?? null,
      set: async (id, credential) => {
        records.set(keyFor(id), credential)
      },
      delete: async (id) => records.delete(keyFor(id)),
    })

    expect(await store.load()).toBeNull()
    expect(records.size).toBe(0)
  })
})
