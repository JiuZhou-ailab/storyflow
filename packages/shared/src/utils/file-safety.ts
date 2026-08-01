// input: User-selected or workspace-relative file paths
// output: Shared sensitive-file classification for attachment and filesystem boundaries
// pos: Pure security policy reused by renderer discovery and main-side path validation

const SENSITIVE_FILE_PATTERNS = [
  /(^|\/)\.ssh(\/|$)/i,
  /(^|\/)\.gnupg(\/|$)/i,
  /(^|\/)\.aws\/credentials$/i,
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)credentials\.json$/i,
  /(^|\/)secrets?\.[^/]+$/i,
  /\.(?:pem|key)$/i,
]

export function isSensitiveFilePath(path: string): boolean {
  const normalizedPath = path.replace(/\\/g, '/')
  return SENSITIVE_FILE_PATTERNS.some(pattern => pattern.test(normalizedPath))
}
