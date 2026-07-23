// input: Application config path and runtime workspace ids
// output: Runtime workspace resolution invariants for Free Conversations
// pos: Guards the synthetic workspace from leaking into the project catalog

import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { CONFIG_DIR, getWorkspaces } from '../../config/storage.ts'
import { FREE_CONVERSATION_WORKSPACE_ID } from '../../protocol/dto.ts'
import {
  getFreeConversationWorkspace,
  listSessionWorkspaces,
  resolveRuntimeWorkspace,
} from '../application-context.ts'

describe('Free Conversation application context', () => {
  it('uses a stable application-owned root outside project discovery', () => {
    const workspace = getFreeConversationWorkspace()

    expect(workspace.id).toBe(FREE_CONVERSATION_WORKSPACE_ID)
    expect(workspace.rootPath).toBe(join(CONFIG_DIR, 'runtime', 'free'))
    expect(getWorkspaces().some((project) => project.id === workspace.id)).toBe(false)
  })

  it('participates in session roots without becoming a configured project', () => {
    const sessionWorkspaces = listSessionWorkspaces()

    expect(sessionWorkspaces[0]?.id).toBe(FREE_CONVERSATION_WORKSPACE_ID)
    expect(resolveRuntimeWorkspace(FREE_CONVERSATION_WORKSPACE_ID)?.id)
      .toBe(FREE_CONVERSATION_WORKSPACE_ID)
  })

  it('resolves the hidden Free Conversations workspace from its stable id', () => {
    const workspace = resolveRuntimeWorkspace(FREE_CONVERSATION_WORKSPACE_ID)

    expect(workspace).toEqual(getFreeConversationWorkspace())
  })
})
