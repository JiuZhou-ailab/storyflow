// input: Native workspace file path and Electron shell boundary callbacks
// output: Awaitable file reveal action for workspace context menus
// pos: Testable application-action seam between the virtual tree and local filesystem shell

export interface RevealWorkspaceFileOptions {
  path: string
  showInFolder: (path: string) => Promise<void>
  onError: (error: unknown) => void
}

export async function revealWorkspaceFile({
  path,
  showInFolder,
  onError,
}: RevealWorkspaceFileOptions): Promise<void> {
  try {
    await showInFolder(path)
  } catch (error) {
    onError(error)
  }
}
