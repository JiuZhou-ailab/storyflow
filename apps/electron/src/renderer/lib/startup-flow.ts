// input: Auth/setup completion state, window workspace, and project catalog metadata
// output: Renderer app state and the most recent non-archived startup project
// pos: Central startup decision point before project or workspace UI is shown

export type PostSetupAppState = 'ready' | 'project-hub' | 'workspace-picker'

export function resolvePostSetupAppState(input: {
  windowWorkspaceId: string | null | undefined
  workspaceCount: number
}): PostSetupAppState {
  if (input.windowWorkspaceId) return 'ready'
  return 'project-hub'
}

export function selectStartupWorkspaceId(
  workspaces: Array<{ id: string; lastAccessedAt?: number; archivedAt?: number }>,
): string | null {
  return workspaces
    .filter(workspace => !workspace.archivedAt)
    .sort((left, right) => (right.lastAccessedAt ?? 0) - (left.lastAccessedAt ?? 0))[0]?.id ?? null
}
