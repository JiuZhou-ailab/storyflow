// input: Persisted workspace records at desktop startup
// output: Workspace id assigned to the first BrowserWindow
// pos: Keeps startup window selection separate from workspace creation policy

export function resolveStartupWindowWorkspaceId(workspaces: Array<{ id: string }>): string {
  return workspaces[0]?.id ?? ''
}
