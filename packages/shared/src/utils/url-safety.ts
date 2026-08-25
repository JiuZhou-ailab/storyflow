/**
 * Classification of external URLs for `shell.openExternal`-style handlers.
 *
 * We use a blocklist instead of an allowlist: the OS only dispatches URL
 * schemes that have a registered handler, so passing through
 * `obsidian://`, `vscode://`, etc. is safe in practice. Known-dangerous
 * schemes (XSS primitives and `file:` as an RCE vector on Windows) stay
 * explicitly blocked, with a per-scheme reason so blocked attempts produce a
 * useful error message instead of a generic "Invalid URL".
 */

export type UrlClassification =
  | { kind: 'dangerous'; scheme?: string; reason: string }
  | { kind: 'internal-deeplink' }
  | { kind: 'safe-external' }

const DANGEROUS_SCHEMES: ReadonlyMap<string, string> = new Map([
  ['javascript:', 'JavaScript URLs can execute arbitrary code in the renderer (XSS vector).'],
  ['data:', 'data: URLs can embed executable content and bypass scheme restrictions.'],
  ['vbscript:', 'VBScript URLs are a legacy script-execution vector.'],
  ['blob:', 'blob: URLs are renderer-scoped and do not resolve outside this window.'],
  ['file:', 'file: URLs are blocked because shell.openExternal can launch local executables on Windows (Electron RCE class). Use an in-app preview block or open the file from your OS file manager.'],
])

const INTERNAL_DEEPLINK_SCHEME = 'craftagents:'
const MAX_DEEP_LINK_LENGTH = 16 * 1024
const MAX_DEEP_LINK_PARAMETERS = 32
const MAX_DEEP_LINK_PARAMETER_LENGTH = 4096

/** Keep custom-protocol payloads bounded before they cross IPC or become history state. */
export function isDeepLinkWithinLimits(parsed: URL): boolean {
  if (parsed.href.length > MAX_DEEP_LINK_LENGTH) return false

  let parameterCount = 0
  for (const [key, value] of parsed.searchParams) {
    parameterCount++
    if (
      parameterCount > MAX_DEEP_LINK_PARAMETERS
      || key.length > 256
      || value.length > MAX_DEEP_LINK_PARAMETER_LENGTH
    ) {
      return false
    }
  }

  return true
}

/** External deep links may only request actions that still require user confirmation. */
export function isAllowedExternalDeepLinkAction(action: string | undefined): action is 'install-skill' {
  return action === 'install-skill'
}

export function classifyExternalUrl(rawUrl: string): UrlClassification {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    return { kind: 'dangerous', reason: 'empty URL' }
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    return { kind: 'dangerous', reason: 'malformed URL' }
  }

  const protocol = parsed.protocol.toLowerCase()

  const blockedReason = DANGEROUS_SCHEMES.get(protocol)
  if (blockedReason) {
    return { kind: 'dangerous', scheme: protocol, reason: blockedReason }
  }

  if (protocol === INTERNAL_DEEPLINK_SCHEME) {
    return { kind: 'internal-deeplink' }
  }

  return { kind: 'safe-external' }
}

export function isSafeExternalUrl(rawUrl: string): boolean {
  return classifyExternalUrl(rawUrl).kind === 'safe-external'
}

export function formatBlockedUrlError(classification: UrlClassification): string {
  if (classification.kind !== 'dangerous') return ''
  const suffix = classification.scheme ? ` (${classification.scheme})` : ''
  return `URL blocked${suffix}. ${classification.reason}`
}
