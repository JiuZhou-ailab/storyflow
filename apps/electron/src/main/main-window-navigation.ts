// input: A navigation target URL and the main window's renderer entry URL
// output: Whether main-window navigation stays in-app, is blocked, or goes to the OS browser
// pos: Main window will-navigate / window.open policy — only the app's own renderer entry receives electronAPI

import { isSafeExternalUrl } from '@craft-agent/shared/utils/url-safety'

export type MainWindowNavigation = 'allow' | 'block' | 'external'

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/** Entry identity ignores query and hash so in-app hash routes keep working. */
function entryKey(url: URL): string {
  return `${url.protocol}//${url.host}${url.pathname}`
}

export function classifyMainWindowNavigation(rawUrl: string, entryUrl: string): MainWindowNavigation {
  const target = parseUrl(rawUrl)
  const entry = parseUrl(entryUrl)
  if (!target || !entry) return 'block'
  if (entryKey(target) === entryKey(entry)) return 'allow'
  // Any other local page or same-origin dev page would inherit the privileged preload.
  if (target.origin === entry.origin) return 'block'
  // Shares the OPEN_URL blocklist: file:, script/data schemes and craftagents: never reach the OS.
  return isSafeExternalUrl(rawUrl) ? 'external' : 'block'
}
