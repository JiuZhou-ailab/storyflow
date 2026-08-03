// input: Renderer workspace state and mocked Electron LLM connection APIs
// output: Regression coverage for project-only workspace settings reads
// pos: Guards the runtime-workspace and persistent-project boundary during provider refresh

import { afterEach, describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import { FREE_CONVERSATION_WORKSPACE_ID } from '@craft-agent/shared/protocol'
import type { LlmConnectionWithStatus } from '../../../shared/types'
import {
  llmConnectionsAtom,
  refreshLlmConnectionsAtom,
  workspaceDefaultLlmConnectionAtom,
} from '../llm-connections'
import { windowWorkspaceIdAtom } from '../sessions'

const originalWindow = globalThis.window

afterEach(() => {
  if (originalWindow) {
    globalThis.window = originalWindow
  } else {
    // @ts-expect-error test cleanup for window shim
    delete globalThis.window
  }
})

describe('LLM connection refresh', () => {
  it('refreshes connections without reading project settings for Free Conversations', async () => {
    let settingsReads = 0
    const connections: LlmConnectionWithStatus[] = [{
      slug: 'managed',
      name: 'Managed',
      providerType: 'pi_compat',
      authType: 'none',
      createdAt: 1,
      isAuthenticated: true,
    }]
    globalThis.window = {
      electronAPI: {
        listLlmConnectionsWithStatus: async () => connections,
        getWorkspaceSettings: async () => {
          settingsReads += 1
          return { defaultLlmConnection: 'managed' }
        },
      },
    } as unknown as Window & typeof globalThis

    const store = createStore()
    store.set(windowWorkspaceIdAtom, FREE_CONVERSATION_WORKSPACE_ID)
    store.set(workspaceDefaultLlmConnectionAtom, 'stale-project-default')

    await store.set(refreshLlmConnectionsAtom)

    expect(settingsReads).toBe(0)
    expect(store.get(llmConnectionsAtom)).toEqual(connections)
    expect(store.get(workspaceDefaultLlmConnectionAtom)).toBeUndefined()
  })
})
