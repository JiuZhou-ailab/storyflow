// input: NavigationContext source text and default project route expectations
// output: Static regression checks for default route session auto-selection
// pos: Guards project entry routing without mounting the provider

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const navigationContextSource = readFileSync(
  new URL('../NavigationContext.tsx', import.meta.url),
  'utf-8'
)
const sessionListSource = readFileSync(
  new URL('../../components/app-shell/SessionList.tsx', import.meta.url),
  'utf-8'
)
const chatDisplaySource = readFileSync(
  new URL('../../components/app-shell/ChatDisplay.tsx', import.meta.url),
  'utf-8'
)
const appShellSource = readFileSync(
  new URL('../../components/app-shell/AppShell.tsx', import.meta.url),
  'utf-8'
)

describe('project default navigation', () => {
  it('auto-selects a recent session for the initial default allSessions route', () => {
    expect(navigationContextSource).toContain('navigate(routes.view.allSessions())')
    expect(navigationContextSource).not.toContain('navigate(routes.view.allSessions(), { skipAutoSelect: true })')
  })

  it('lets restored project landing routes skip auto-select without bypassing route validation', () => {
    expect(navigationContextSource).toContain('shouldPreserveProjectLandingRoute(params)')
    expect(navigationContextSource).toContain('resolveAutoSelectionRef.current(state, { skipAutoSelect: true })')
    expect(navigationContextSource).toContain('normalizePanelRouteForReconcile(')
    expect(navigationContextSource).not.toContain("if ('details' in navState && navState.details)")
  })

  it('removes the broad navigation provider after splitting actions and state', () => {
    expect(navigationContextSource).not.toContain('createContext<NavigationContextValue')
    expect(navigationContextSource).not.toContain('<NavigationContext.Provider')
    expect(navigationContextSource).not.toContain('export function useNavigation()')
    expect(navigationContextSource).toContain('const actionsValue = useMemo<NavigationActionsContextValue>(() => ({')
    expect(navigationContextSource).toContain('<NavigationActionsContext.Provider value={actionsValue}>')
  })

  it('guards right sidebar state against semantic no-op writes', () => {
    expect(navigationContextSource).toContain('function areRightSidebarPanelsEqual')
    expect(navigationContextSource).toContain('const setRightSidebarIfChanged = useCallback')
    expect(navigationContextSource).toContain('setRightSidebar(previous => areRightSidebarPanelsEqual(previous, panel) ? previous : panel)')
    expect(navigationContextSource).toContain('setRightSidebarIfChanged(parsed.rightSidebar)')
    expect(navigationContextSource).toContain('setRightSidebarIfChanged(panel)')
  })

  it('checks session filter matches directly from the metadata map during auto-select', () => {
    expect(navigationContextSource).toContain('const doesSessionMatchFilter = useCallback')
    expect(navigationContextSource).toContain('for (const session of sessionMetaMap.values())')
    expect(navigationContextSource).toContain('const session = sessionMetaMap.get(storedId)')
    expect(navigationContextSource).not.toContain('const sessionMetas = useMemo(() => Array.from(sessionMetaMap.values())')
    expect(navigationContextSource).not.toContain('const filtered = filterSessionsByFilter(filter)')
  })

  it('reads session metadata on demand instead of subscribing the provider to every meta update', () => {
    expect(navigationContextSource).not.toContain('useAtomValue(sessionMetaMapAtom)')
    expect(navigationContextSource).toContain('const sessionMetaMap = store.get(sessionMetaMapAtom)')
  })

  it('keeps navigation-state-only consumers off navigation action context updates', () => {
    expect(navigationContextSource).toContain('const NavigationStateContext = createContext<NavigationState | null>(null)')
    expect(navigationContextSource).toContain('<NavigationStateContext.Provider value={navigationState}>')
    expect(navigationContextSource).not.toContain('const { navigationState } = useNavigation()')
  })

  it('keeps action-only navigation consumers off navigation state context updates', () => {
    expect(navigationContextSource).toContain('const NavigationActionsContext = createContext<NavigationActionsContextValue | null>(null)')
    expect(navigationContextSource).toContain('const actionsValue = useMemo<NavigationActionsContextValue>(() => ({')
    expect(navigationContextSource).toContain('const currentNavigationState = navigationStateRef.current')
    expect(sessionListSource).toContain('useNavigationActions')
    expect(chatDisplaySource).toContain('useNavigationActions')
    expect(appShellSource).toContain('useNavigationActions')
  })
})
