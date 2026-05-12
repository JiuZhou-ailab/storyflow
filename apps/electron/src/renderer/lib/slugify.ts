// input: User-entered workspace names
// output: Stable filesystem-safe slugs aligned with shared workspace storage
// pos: Renderer-side workspace naming helper before create/check workspace calls

/**
 * Convert a string to a URL/filesystem-safe slug
 * - Lowercase
 * - Replace non-alphanumeric runs with hyphens
 * - Trim leading/trailing hyphens
 * - Fall back to a stable hash for names without ASCII slug content
 */
export function slugify(str: string): string {
  const trimmed = str.trim()
  if (!trimmed) return ''

  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50)

  if (slug) return slug

  let hash = 0x811c9dc5
  for (const char of trimmed) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return `workspace-${hash.toString(36)}`
}

/**
 * Check if a string is a valid slug (already slugified)
 */
export function isValidSlug(str: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(str)
}
