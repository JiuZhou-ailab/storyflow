// input: A navigation target URL and the main window's renderer entry URL
// output: Whether main-window navigation stays in-app, is blocked, or goes to the OS browser
// pos: Main window will-navigate policy — only the app's own renderer entry receives electronAPI

export type MainWindowNavigation = 'allow' | 'block' | 'external'

/** Entry identity ignores query and hash so in-app hash routes keep working. */
function entryKey(url: URL): string {
  return `${url.protocol}//${url.host}${url.pathname}`
}

export function classifyMainWindowNavigation(rawUrl: string, entryUrl: string): MainWindowNavigation {
  let target: URL
  try {
    target = new URL(rawUrl)
  } catch {
    return 'block'
  }
  const entry = new URL(entryUrl)
  if (entryKey(target) === entryKey(entry)) return 'allow'
  // Any other local page or same-origin dev page would inherit the privileged preload.
  if (target.protocol === 'file:' || target.origin === entry.origin) return 'block'
  return 'external'
}
