// input: Current selection plus workspace-scoped session ids and metadata
// output: The conversation that the writing surface can render immediately
// pos: Pure selection policy between session state and the writing chat surface

interface WritingSessionMeta {
  id: string
  workspaceId?: string | null
  hidden?: boolean
  isArchived?: boolean
}

interface ResolveWritingSessionIdInput {
  sessionIds: readonly string[]
  sessionMetaMap: ReadonlyMap<string, WritingSessionMeta>
  selectedSessionId?: string | null
  activeWorkspaceId?: string | null
  remoteWorkspaceId?: string | null
}

function belongsToWorkspace(
  meta: WritingSessionMeta,
  activeWorkspaceId?: string | null,
  remoteWorkspaceId?: string | null,
): boolean {
  return !activeWorkspaceId
    || meta.workspaceId === activeWorkspaceId
    || (!!remoteWorkspaceId && meta.workspaceId === remoteWorkspaceId)
}

function isRenderable(
  meta: WritingSessionMeta | undefined,
  activeWorkspaceId?: string | null,
  remoteWorkspaceId?: string | null,
): meta is WritingSessionMeta {
  return !!meta
    && !meta.hidden
    && !meta.isArchived
    && belongsToWorkspace(meta, activeWorkspaceId, remoteWorkspaceId)
}

export function resolveWritingSessionId({
  sessionIds,
  sessionMetaMap,
  selectedSessionId,
  activeWorkspaceId,
  remoteWorkspaceId,
}: ResolveWritingSessionIdInput): string | null {
  const selectedMeta = selectedSessionId ? sessionMetaMap.get(selectedSessionId) : undefined
  if (isRenderable(selectedMeta, activeWorkspaceId, remoteWorkspaceId)) {
    return selectedMeta.id
  }

  for (const sessionId of sessionIds) {
    const meta = sessionMetaMap.get(sessionId)
    if (isRenderable(meta, activeWorkspaceId, remoteWorkspaceId)) {
      return sessionId
    }
  }

  return null
}
