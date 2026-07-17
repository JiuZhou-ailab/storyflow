// input: User-configured MCP endpoint URL
// output: Stable endpoint URL without trailing separators
// pos: Runtime-neutral MCP URL normalization shared by validation and adapters

export function normalizeMcpUrl(url: string): string {
  return url.replace(/\/+$/, '');
}
