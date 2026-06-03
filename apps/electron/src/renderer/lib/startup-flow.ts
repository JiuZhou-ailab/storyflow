// input: Auth/setup completion state, window workspace, and project availability
// output: Renderer app state after setup has completed
// pos: Central startup decision point before project or workspace UI is shown

export type PostSetupAppState = 'ready' | 'project-hub' | 'workspace-picker' | 'workspace-creation'

export function resolvePostSetupAppState(input: {
  windowWorkspaceId: string | null | undefined
  workspaceCount: number
}): PostSetupAppState {
  if (input.windowWorkspaceId) return 'ready'
  return 'project-hub'
}
