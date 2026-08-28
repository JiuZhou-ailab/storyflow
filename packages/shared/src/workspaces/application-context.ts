// input: Runtime workspace ids plus the configured Storyflow application root
// output: Hidden Free Conversation Workspace and runtime-workspace resolution
// pos: Thin domain adapter shared by session, RPC, and resource boundaries

import { join } from 'node:path'
import type { Workspace } from '@craft-agent/core/types'
import {
  FREE_CONVERSATION_WORKSPACE_ID,
  FREE_CONVERSATION_WORKSPACE_SLUG,
} from '../protocol/dto.ts'
import { CONFIG_DIR } from '../config/paths.ts'
import { getWorkspaceById, getWorkspaceByNameOrId, getWorkspaces } from '../config/storage.ts'
import { isWorkspaceRootAvailable } from './project-registry.ts'

export { FREE_CONVERSATION_WORKSPACE_SLUG } from '../protocol/dto.ts'

export function getFreeConversationWorkspace(): Workspace {
  return {
    id: FREE_CONVERSATION_WORKSPACE_ID,
    name: '自由对话',
    slug: FREE_CONVERSATION_WORKSPACE_SLUG,
    rootPath: join(CONFIG_DIR, 'runtime', 'free'),
    createdAt: 0,
    localMcpEnabled: true,
    automationsEnabled: true,
  }
}

export function isFreeConversationWorkspaceId(workspaceId: string | null | undefined): boolean {
  return workspaceId === FREE_CONVERSATION_WORKSPACE_ID
}

export function resolveRuntimeWorkspace(workspaceId: string): Workspace | null {
  if (isFreeConversationWorkspaceId(workspaceId)) {
    return getFreeConversationWorkspace()
  }
  return getWorkspaceByNameOrId(workspaceId)
}

/** Resolve an internal Project reference without allowing a Host name to impersonate its ID. */
export function resolveRuntimeWorkspaceById(workspaceId: string): Workspace | null {
  if (isFreeConversationWorkspaceId(workspaceId)) {
    return getFreeConversationWorkspace()
  }
  return getWorkspaceById(workspaceId)
}

export function listSessionWorkspaces(): Workspace[] {
  return [
    getFreeConversationWorkspace(),
    ...getWorkspaces().filter(workspace => !workspace.remoteServer && isWorkspaceRootAvailable(workspace)),
  ]
}
