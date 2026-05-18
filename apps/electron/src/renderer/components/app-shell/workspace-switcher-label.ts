// input: Raw workspace names
// output: Bounded labels for compact shell controls
// pos: Keeps fixed app chrome from being resized by user project names

export const TOPBAR_WORKSPACE_NAME_MAX_CHARS = 6

export function formatTopbarWorkspaceName(
  name: string | null | undefined,
  maxChars = TOPBAR_WORKSPACE_NAME_MAX_CHARS,
): string {
  const trimmed = name?.trim() || 'Workspace'
  const chars = Array.from(trimmed)

  if (chars.length <= maxChars) return trimmed
  return `${chars.slice(0, maxChars).join('')}...`
}
