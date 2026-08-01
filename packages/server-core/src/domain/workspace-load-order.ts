// input: The session workspaces discovered at startup and the stored active workspace id
// output: The same workspaces, active one first, so its session gate opens earliest
// pos: Pure ordering rule behind ADR 0013 workspace-scoped session-runtime readiness

export interface OrderableWorkspace {
  id: string
}

/**
 * Puts the active workspace first without otherwise reordering discovery.
 *
 * Session discovery opens each workspace's readiness shard as it finishes, so the
 * workspace the user is about to enter should be indexed first. Order is otherwise
 * preserved: this is a priority hint, not a sort.
 */
export function orderWorkspacesByActiveFirst<T extends OrderableWorkspace>(
  workspaces: readonly T[],
  activeWorkspaceId: string | null | undefined,
): T[] {
  if (!activeWorkspaceId) return [...workspaces]
  const activeIndex = workspaces.findIndex(workspace => workspace.id === activeWorkspaceId)
  if (activeIndex <= 0) return [...workspaces]
  const ordered = [...workspaces]
  const [active] = ordered.splice(activeIndex, 1)
  ordered.unshift(active)
  return ordered
}
