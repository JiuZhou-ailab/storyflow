// input: Untrusted portable bundle paths
// output: Cross-platform path validation and collision keys
// pos: Filesystem-independent path contract shared by Workers and local imports

const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const WINDOWS_FORBIDDEN_CHAR = /[<>:"|?*\u0000-\u001f]/

export function validatePortableFilePath(path: string): string | null {
  if (!path) return 'Missing portable relative path'
  if (path.startsWith('/') || path.startsWith('\\')) return 'Absolute path not allowed'
  if (path.includes('\\')) return 'Backslash path separator not allowed'
  if (path.includes('//')) return 'Invalid path (double slash)'
  const segments = path.split('/')
  for (const segment of segments) {
    if (segment === '..') return 'Path traversal detected'
    if (!segment || segment === '.') return `Invalid path segment: ${segment || '(empty)'}`
    if (segment.endsWith('.') || segment.endsWith(' ')) return `Non-portable path segment: ${segment}`
    if (WINDOWS_FORBIDDEN_CHAR.test(segment) || WINDOWS_RESERVED_NAME.test(segment)) {
      return `Non-portable path segment: ${segment}`
    }
  }
  return null
}

export function portablePathCollisionKey(path: string): string {
  return path.normalize('NFC').toLowerCase()
}
