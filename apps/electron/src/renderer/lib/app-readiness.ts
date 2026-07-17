// input: Renderer route state and the selected workspace identity
// output: Boolean readiness decision for revealing the project shell
// pos: Keeps project rendering independent from background agent/session hydration

export interface AppReadinessInput {
  appState: string
  workspaceId: string | null
}

export function isProjectShellReady(input: AppReadinessInput): boolean {
  return input.appState === 'ready' && input.workspaceId !== null
}
