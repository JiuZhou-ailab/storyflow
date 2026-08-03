// input: Electron LLM connection IPC APIs and active workspace id atom
// output: Shared renderer LLM connection state and refresh action
// pos: Subscription boundary for provider/model selectors outside AppShellContext

import { atom } from 'jotai'
import { FREE_CONVERSATION_WORKSPACE_ID } from '@craft-agent/shared/protocol'
import type { LlmConnectionWithStatus } from '../../shared/types'
import { windowWorkspaceIdAtom } from './sessions'

export const llmConnectionsAtom = atom<LlmConnectionWithStatus[]>([])
export const workspaceDefaultLlmConnectionAtom = atom<string | undefined>(undefined)

export const refreshLlmConnectionsAtom = atom(null, async (get, set) => {
  const connections = await window.electronAPI.listLlmConnectionsWithStatus()
  set(llmConnectionsAtom, connections)

  const workspaceId = get(windowWorkspaceIdAtom)
  if (!workspaceId || workspaceId === FREE_CONVERSATION_WORKSPACE_ID) {
    set(workspaceDefaultLlmConnectionAtom, undefined)
    return
  }

  const settings = await window.electronAPI.getWorkspaceSettings(workspaceId)
  set(workspaceDefaultLlmConnectionAtom, settings?.defaultLlmConnection)
})
