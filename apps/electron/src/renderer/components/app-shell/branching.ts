// input: Legacy branch navigation options emitted by the shared turn-card UI.
// output: The writing workspace's single-conversation-panel navigation policy.
// pos: Renderer boundary preventing branch creation from appending chat panels.

export function resolveBranchNewPanelOption(_options?: { newPanel?: boolean }): boolean {
  return false
}
