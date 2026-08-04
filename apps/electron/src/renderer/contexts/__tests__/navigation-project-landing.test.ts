// input: NavigationContext, ProjectHub navigation, and default project route expectations
// output: Static regression checks for default entry and reversible ProjectHub navigation
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
const mainContentPanelSource = readFileSync(
  new URL('../../components/app-shell/MainContentPanel.tsx', import.meta.url),
  'utf-8'
)
const appSource = readFileSync(
  new URL('../../App.tsx', import.meta.url),
  'utf-8'
)
const activityRailSource = readFileSync(
  new URL('../../components/app-shell/ActivityRail.tsx', import.meta.url),
  'utf-8'
)
const projectHubNavigationSource = readFileSync(
  new URL('../../components/project-hub/ProjectHubNavigation.ts', import.meta.url),
  'utf-8'
)
describe('project default navigation', () => {
  it('lands on the writing route without waiting for session auto-selection', () => {
    expect(navigationContextSource).toContain('defaultViewRoute = routes.view.writing()')
    expect(navigationContextSource).toContain('navigate(defaultViewRoute)')
    expect(navigationContextSource).not.toContain('navigate(routes.view.allSessions(), { skipAutoSelect: true })')
  })

  it('keeps project conversations in project chrome and excludes Free Conversations', () => {
    expect(appShellSource).toContain('const showWritingWorkspaceShell = isProjectRuntime')
    expect(appShellSource).toContain('&& (isWritingNavigation(navState) || isSessionsNavigation(navState))')
    // The document surface is writing-route-only so the navigator column can
    // hand itself to the project's conversation list on the session route.
    expect(appShellSource).toContain('const showNovelDocumentNavigator = showWritingDocumentSurface && showNovelWorkspaceSidebar')
    expect(appShellSource).toContain('const showPrimarySidebar = hasPrimarySidebar && showWritingWorkspaceShell')
  })

  it('shows the default conversation without putting ChatPage on the project-shell critical path', () => {
    expect(mainContentPanelSource).toContain('if (isWritingNavigation(navState))')
    expect(mainContentPanelSource).toContain('<WritingSessionContent')
    expect(mainContentPanelSource).toContain('useAtomValue(sessionIdsAtom)')
    expect(mainContentPanelSource).toContain('useAtomValue(sessionMetaMapAtom)')
    expect(mainContentPanelSource).toContain("const LazyChatPage = React.lazy(() => import('@/pages/ChatPage'))")
    expect(mainContentPanelSource).toContain('useContext(WritingPrimaryContentReadyContext)')
    expect(mainContentPanelSource).toContain('if (!primaryContentReady) return')
    expect(mainContentPanelSource).toContain('React.startTransition(() => {')
    expect(mainContentPanelSource).not.toContain('window.requestAnimationFrame(() => {')
    expect(mainContentPanelSource).toContain('<LazyChatPage sessionId={sessionId} />')
    expect(mainContentPanelSource).not.toContain("import { SourceInfoPage, ChatPage } from '@/pages'")
    expect(appShellSource).toContain('<WritingPrimaryContentReadyContext.Provider value={writingPrimaryContentReady}>')
    expect(appShellSource).toContain('loadedNovelDocumentPath === selectedNovelDocumentPath')
  })

  it('keeps the rail conversation list scoped to the free-conversation domain', () => {
    // The rail must ask for one named workspace. A cross-workspace fetch here
    // is what put project conversations in the free list (ADR 0006).
    expect(activityRailSource).toContain('listSessionsByWorkspace(FREE_CONVERSATION_WORKSPACE_ID)')
    expect(activityRailSource).not.toContain('getAllSessions')
    // Resolve the live runtime atom through one workspace-aware helper so
    // project updates cannot leak into the free list.
    expect(activityRailSource).toContain('const activityFreeSessionMetasAtom = atom<SessionMeta[] | null>(null)')
    expect(activityRailSource).toContain('const runtimeSessionMetasAtom = selectAtom(')
    expect(activityRailSource).toContain('resolveActivityWorkspaceSessionMetas(')
    expect(activityRailSource).toContain('runtimeMetas.filter(meta => meta.workspaceId === workspaceId)')
    // Per-row workspace labels only exist to excuse a mixed list.
    expect(activityRailSource).not.toContain("?.name ?? '项目'")
    expect(activityRailSource).not.toContain("| 'free-conversations'")
    expect(activityRailSource).not.toContain('dataTutorial="activity-free-conversations"')
    expect(appShellSource).not.toContain('onOpenWritingWorkspace={onOpenWritingWorkspace}')
    expect(appShellSource).toContain('onOpenFreeConversations={onOpenFreeConversations}')
    expect(appShellSource).toContain("if (isSessionsNavigation(navState)) return 'recent'")
    expect(appShellSource).toContain('onSelectSession={handleActivitySessionSelect}')
  })

  it('keeps a project-owned conversation list reachable inside the project', () => {
    // ADR 0006 revision: the rail carries project conversations as a two-level
    // tree, so the standalone SessionList navigator is no longer their only
    // entry. What must hold is that selecting a project conversation is an
    // EXPLICIT cross-domain switch — activating the owning runtime and
    // deep-linking to the session — never a silent overlay merging two domains.
    // A single rail callback branches on domain: in-domain focuses in place,
    // cross-domain delegates to the runtime-switch primitive.
    expect(appShellSource).toContain('if (workspaceId === activeWorkspaceId)')
    expect(appShellSource).toContain('await onSelectProjectSession(workspaceId, sessionId)')
    expect(appShellSource).toContain('requestAnimationFrame(() => focusChatInputForSession(sessionId))')
    expect(sessionListSource).toContain('onFocusChatInput?.(row.item.id)')
    expect(appShellSource).toContain('const hideSessionListNavigator = isSkillsNavigation(navState)')
    expect(appShellSource).toContain('isProjectRuntime && isWritingNavigation(navState)')
    expect(appShellSource).toContain('isSessionsNavigation(navState) && (!showActivityRail || isAutoCompact)')
    // The manuscript owns a column outright rather than borrowing the navigator,
    // which is what previously made the two mutually exclusive.
    expect(appShellSource).toContain('const navigatorPanelWidth = sessionListWidth')
    expect(appShellSource).not.toContain('const showWritingDocumentSurface = isProjectRuntime && isWritingNavigation(navState)')
  })

  it('keeps route auto-selection session-only while writing owns its metadata-driven default', () => {
    const autoSelectSource = navigationContextSource.slice(
      navigationContextSource.indexOf('// AUTO-SELECT ON SESSION LOAD'),
      navigationContextSource.indexOf('const actionsValue')
    )

    expect(autoSelectSource).toContain('if (!isReady || !isSessionsReady || !workspaceId) return')
    expect(autoSelectSource).toContain('if (!isSessionsNavigation(navigationState) || navigationState.details) return')
    expect(autoSelectSource).not.toContain('isWritingNavigation(navigationState)')
    expect(autoSelectSource).not.toContain('setSession({ selected:')
    expect(mainContentPanelSource).toContain('const defaultSessionId = useMemo(() => {')
    expect(mainContentPanelSource).toContain('select(defaultSessionId, sessionIds.indexOf(defaultSessionId))')
  })

  it('returns from the project hub to the exact source route with a writing fallback', () => {
    const returnHandlerSource = appSource.slice(
      appSource.indexOf('const handleReturnToActiveProject'),
      appSource.indexOf('const handleOpenRuntimeRoute')
    )

    expect(returnHandlerSource).toContain('activateRuntimeWorkspace(')
    expect(returnHandlerSource).toContain('activeProjectId,')
    expect(returnHandlerSource).toContain('consumeReturnRoute(routes.view.writing())')
    expect(projectHubNavigationSource).toContain('{ workspaceId: activeWorkspaceId, route: focusedRoute }')
    expect(projectHubNavigationSource).toContain('location?.workspaceId === activeWorkspaceId ? location.route : fallback')
  })

  it('preloads the workspace module during project-hub idle time', () => {
    expect(appSource).toContain('workspaceSurfaceModulePromise ??= import(')
    expect(appSource).toContain("if (appState !== 'project-hub') return")
    expect(appSource).toContain('window.requestIdleCallback(preloadWorkspaceSurface)')
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

  it('revalidates the runtime route captured by a delayed project Skill install confirmation', () => {
    expect(navigationContextSource).toContain('const targetRuntimeWorkspaceId = workspaceId')
    expect(navigationContextSource).toContain('runtimeWorkspaceRouteRef.current !== targetRuntimeWorkspaceId')
    expect(navigationContextSource).toContain('targetRuntimeWorkspaceId, downloaded.bundle')
    expect(navigationContextSource).toContain("{ skillScope: 'project' }")
    expect(navigationContextSource).not.toContain('importResources(workspaceId, downloaded.bundle')
  })

  it('keeps the bare Skills route as the native Hub instead of selecting the first local Skill', () => {
    expect(navigationContextSource).not.toContain('// Skills: auto-select first skill')
    expect(navigationContextSource).not.toContain('getFirstSkillSlug')
    expect(appShellSource).toContain('const hideSessionListNavigator = isSkillsNavigation(navState)')
    expect(appShellSource).toContain('navigatorWidth={hideSessionListNavigator')
    expect(mainContentPanelSource).toContain('<SkillsHubPage')
  })
})
