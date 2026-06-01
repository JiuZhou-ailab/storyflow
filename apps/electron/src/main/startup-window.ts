// input: Persisted workspace records at desktop startup
// output: Workspace id assigned to the ordinary startup BrowserWindow
// pos: Keeps ordinary desktop startup on the project hub before any workspace is opened

export function resolveStartupWindowWorkspaceId(workspaces: Array<{ id: string }>): string {
  void workspaces
  return ''
}

export function shouldRestoreWorkspaceWindowsOnOrdinaryStartup(input: {
  savedWindowCount: number
}): boolean {
  void input
  return false
}

export function resolveActivateWindowWorkspaceId(workspaces: Array<{ id: string }>): string {
  return resolveStartupWindowWorkspaceId(workspaces)
}
