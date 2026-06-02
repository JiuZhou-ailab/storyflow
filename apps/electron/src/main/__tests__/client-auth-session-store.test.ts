// input: Fake credential manager records for desktop client auth sessions
// output: Regression coverage for encrypted session-store adapter behavior
// pos: Guards restart auth persistence without depending on the real credential backend

import { describe, expect, it } from 'bun:test'
import type { StoredCredential } from '@craft-agent/shared/credentials'
import { createClientAuthSessionStore } from '../client-auth-session-store'

describe('createClientAuthSessionStore', () => {
  it('saves, loads, and clears the desktop auth session credential', async () => {
    let storedCredential: StoredCredential | null = null
    let deleteCount = 0
    const store = createClientAuthSessionStore({
      get: async (id) => {
        expect(id).toEqual({ type: 'client_auth_session' })
        return storedCredential
      },
      set: async (id, credential) => {
        expect(id).toEqual({ type: 'client_auth_session' })
        storedCredential = credential
      },
      delete: async (id) => {
        expect(id).toEqual({ type: 'client_auth_session' })
        deleteCount += 1
        storedCredential = null
        return true
      },
    })

    await store.save({
      user: {
        provider: 'feishu',
        userId: 'ou_user',
        email: 'USER@example.com',
        name: 'User',
      },
      appSessionToken: 'app-session-token',
    })

    expect(await store.load()).toEqual({
      user: {
        provider: 'feishu',
        userId: 'ou_user',
        email: 'user@example.com',
        name: 'User',
      },
      appSessionToken: 'app-session-token',
    })

    await store.clear()

    expect(deleteCount).toBe(1)
    expect(await store.load()).toBeNull()
  })

  it('ignores malformed persisted session records', async () => {
    const store = createClientAuthSessionStore({
      get: async () => ({ value: JSON.stringify({ user: { provider: 'neon' } }) }),
      set: async () => {},
      delete: async () => false,
    })

    expect(await store.load()).toBeNull()
  })
})
