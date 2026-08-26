// input: Host workspaces and a stable or legacy URL workspace key
// output: The matching workspace, preferring canonical Host identity
// pos: Backward-compatible boundary for Project navigation URLs

export function findWorkspaceByRouteKey<T extends { id: string; slug: string; rootAvailable?: boolean }>(
  workspaces: readonly T[],
  routeKey: string,
): T | undefined {
  const workspace = workspaces.find(workspace => workspace.id === routeKey)
    ?? workspaces.find(workspace => workspace.slug === routeKey)
  return workspace?.rootAvailable === false ? undefined : workspace
}
