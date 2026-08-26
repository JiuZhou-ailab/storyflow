// input: A resolved Source and the Project's Host-owned local MCP grant
// output: Whether the renderer must present that Project stdio Source as disabled
// pos: Pure UI projection of the server-side Project execution boundary

interface SourceExecutionState {
  origin?: string
  config: { mcp?: { transport?: string } }
}

export function isProjectStdioSourceDisabled(
  source: SourceExecutionState,
  localMcpEnabled: boolean,
): boolean {
  return source.origin === 'workspace'
    && source.config.mcp?.transport === 'stdio'
    && !localMcpEnabled
}
