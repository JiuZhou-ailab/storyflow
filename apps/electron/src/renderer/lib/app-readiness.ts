// input: Renderer startup state and first-frame data loading flags
// output: Boolean readiness decision for releasing the startup splash
// pos: Centralizes app bootstrap gating so default workspace/theme UI stays hidden until hydrated

export interface AppReadinessInput {
  appState: string
  sessionsLoaded: boolean
  workspacesLoaded: boolean
  themeLoaded: boolean
  llmConnectionsLoaded: boolean
  draftsLoaded: boolean
  notificationsLoaded: boolean
}

export function isAppFullyReady(input: AppReadinessInput): boolean {
  return input.appState === 'ready'
    && input.sessionsLoaded
    && input.workspacesLoaded
    && input.themeLoaded
    && input.llmConnectionsLoaded
    && input.draftsLoaded
    && input.notificationsLoaded
}
