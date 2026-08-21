// input: Shared MCP type/validation contracts and SDK-backed client implementations
// output: Main-process MCP runtime — CraftMcpClient, McpClientPool, ApiSourcePoolClient
// pos: Server-core entrypoint for MCP source connectivity; contracts live in @craft-agent/shared/mcp

export { CraftMcpClient } from './client.ts';
export { McpClientPool } from './mcp-pool.ts';
export { ApiSourcePoolClient } from './api-source-pool-client.ts';
