import { isFilePathTarget } from './linkify'

export type ResolvedMarkdownLinkTarget =
  | { kind: 'file'; path: string }
  | { kind: 'url'; url: string }

function normalizeFileUrlPath(path: string): string {
  return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path
}

function resolveFileUrlPath(target: string): string | null {
  if (!/^file:/i.test(target)) return null

  try {
    const parsed = new URL(target)
    if (parsed.protocol !== 'file:') return null

    const pathname = decodeURIComponent(parsed.pathname || '')
    if (!pathname && !parsed.hostname) return null

    if (parsed.hostname) {
      const hostname = decodeURIComponent(parsed.hostname)
      return normalizeFileUrlPath(`//${hostname}${pathname}`)
    }

    return normalizeFileUrlPath(pathname)
  } catch {
    return null
  }
}

function stripLineSuffix(target: string): string {
  return target.replace(/:\d+(?::\d+)?$/, '')
}

/**
 * Decode percent-encoded path segments when present (e.g. ./正文 → ./%E6%AD%A3%E6%96%87).
 * Markdown renderers occasionally emit encoded hrefs; file open needs the real path.
 */
function tryDecodePath(target: string): string {
  if (!/%[0-9A-Fa-f]{2}/.test(target)) return target
  try {
    return decodeURIComponent(target)
  } catch {
    return target
  }
}

/**
 * Resolve markdown link targets for click dispatch.
 *
 * - Raw filesystem paths are routed through onFileClick
 * - Explicit file:// URLs are normalized to filesystem paths and also routed through onFileClick
 * - Everything else is treated as a URL and routed through onUrlClick
 */
export function resolveMarkdownLinkTarget(target: string): ResolvedMarkdownLinkTarget {
  const trimmed = tryDecodePath(target.trim())

  const fileUrlPath = resolveFileUrlPath(trimmed)
  if (fileUrlPath) {
    return { kind: 'file', path: fileUrlPath }
  }

  const withoutLineSuffix = stripLineSuffix(trimmed)
  if (withoutLineSuffix !== trimmed && isFilePathTarget(withoutLineSuffix)) {
    return { kind: 'file', path: withoutLineSuffix }
  }

  if (isFilePathTarget(trimmed)) {
    return { kind: 'file', path: trimmed }
  }

  return { kind: 'url', url: trimmed }
}

/**
 * Backward-compatible classifier for tests and existing callers that only need the kind.
 */
export function classifyMarkdownLinkTarget(target: string): 'file' | 'url' {
  return resolveMarkdownLinkTarget(target).kind
}
