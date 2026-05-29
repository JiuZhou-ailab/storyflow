// input: Auth/setup completion state and workspace availability
// output: Renderer app state after setup has completed
// pos: Central startup decision point for first-run workspace creation

export type PostSetupAppState = 'ready' | 'workspace-picker' | 'workspace-creation'

export function resolvePostSetupAppState(input: {
  windowWorkspaceId: string | null | undefined
  workspaceCount: number
}): PostSetupAppState {
  if (input.windowWorkspaceId) return 'ready'
  return input.workspaceCount === 0 ? 'workspace-creation' : 'workspace-picker'
}
