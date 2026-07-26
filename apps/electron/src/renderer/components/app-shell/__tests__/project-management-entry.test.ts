// input: AppShell, TopBar, ActivityRail, WorkspaceProjectSidebar, and project-creation source
// output: Static regression for rail-owned project management IA
// pos: Project browsing is rail-only; dialogs are reserved for creation forms

import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const appShellSource = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8')
const topBarSource = readFileSync(new URL('../TopBar.tsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8')
const activityRailPath = fileURLToPath(new URL('../ActivityRail.tsx', import.meta.url))
const activityRailSource = readFileSync(activityRailPath, 'utf8')
const projectSwitcherPath = fileURLToPath(new URL('../ProjectSwitcherPopover.tsx', import.meta.url))
const projectSwitcherSource = readFileSync(projectSwitcherPath, 'utf8')
const projectManagerPath = fileURLToPath(new URL('../ProjectManagerPanel.tsx', import.meta.url))
const projectManagerSource = readFileSync(projectManagerPath, 'utf8')
const projectSidebarSource = readFileSync(
  new URL('../../workspace/WorkspaceProjectSidebar.tsx', import.meta.url),
  'utf8',
)

describe('project management entry', () => {
  it('keeps project management in the workspace header instead of a standalone rail icon', () => {
    expect(activityRailSource).toContain('data-tutorial="activity-project-hub"')
    expect(activityRailSource).toContain('aria-label="工作区导航"')
    expect(activityRailSource).toContain('aria-label="新建或导入项目"')
    expect(activityRailSource).not.toContain('aria-label="项目"')
    expect(topBarSource).not.toContain('onOpenProjectHub')
  })

  it('keeps project creation in a small menu and opens dialogs only for forms', () => {
    expect(existsSync(projectManagerPath)).toBe(true)
    expect(projectManagerSource).toContain('data-testid="project-manager-panel"')
    expect(projectManagerSource).toContain('导入文件夹')
    expect(projectManagerSource).toContain('连接远端')
    expect(projectManagerSource).toContain('输入名称，并选择新项目的存储位置。')
    expect(projectManagerSource).not.toContain('选择写作方法')
    expect(projectManagerSource).not.toContain('最近项目')
    expect(projectManagerSource).not.toContain('重命名')
    expect(projectManagerSource).not.toContain('移除')
    expect(projectManagerSource).not.toContain('新窗口打开')
    expect(projectManagerSource).toContain("view === 'create'")
    expect(projectManagerSource).toContain('<AddWorkspaceStep_CreateNew')
    expect(projectManagerSource).toContain('<AddWorkspaceStep_OpenFolder')
    expect(projectManagerSource).toContain('<AddWorkspaceStep_ConnectRemote')
    expect(projectManagerSource).toContain('embedded')
    expect(projectSwitcherSource).toContain('<ProjectManagerPanel')
    expect(projectSwitcherSource).toContain('<Dialog')
    expect(projectSwitcherSource).toContain('<DropdownMenu')
    expect(projectSwitcherSource).not.toContain('<DialogTrigger')
    expect(projectSwitcherSource).toContain("setView('create')")
    expect(projectSwitcherSource).toContain("setView('open')")
    expect(projectSwitcherSource).toContain("setView('remote')")
    expect(projectSwitcherSource).toContain('onWorkspaceCreated={onWorkspaceCreated}')
    expect(appSource).not.toContain('<ProjectManagerPanel')
    expect(appSource).toContain('从左侧展开项目并选择对话')
    expect(appSource).toContain('onWorkspaceCreatedFromRail={projectManagerActions.onWorkspaceCreated}')
    expect(appSource).toContain('onWorkspaceCreated:')
    expect(appSource).not.toMatch(/<ProjectHub[\s>]/)
  })

  it('wires project manager actions through the room AppShell rail', () => {
    expect(appShellSource).toContain('onWorkspaceCreated={onWorkspaceCreatedFromRail ?? onWorkspaceCreated}')
    expect(appShellSource).toContain('onRenameProject={onRenameProject}')
    expect(appShellSource).toContain('onSetProjectArchived={onSetProjectArchived}')
    expect(appShellSource).toContain('onRemoveProject={onRemoveProject}')
    expect(appShellSource).toContain('onOpenProjectInNewWindow={onOpenProjectInNewWindow}')
    expect(appShellSource).toContain('workspaces={workspaces}')
    expect(appShellSource).not.toContain('onSelectProject=')
    expect(activityRailSource).toContain('<ProjectSwitcherPopover')
    expect(activityRailSource).toContain('onWorkspaceCreated={onWorkspaceCreated}')
    expect(activityRailSource).toContain('data-testid="activity-archived-projects"')
    expect(activityRailSource).toContain('<span>归档</span>')
    expect(activityRailSource).toContain('<span>恢复</span>')
    expect(activityRailSource).not.toContain('onCreateProject')
    expect(activityRailSource).not.toContain('onManageProjects')
    expect(activityRailSource).not.toContain('退出到作品库')
  })

  it('keeps plugin navigation at the top of the single workspace sidebar', () => {
    expect(appShellSource).toContain('const showActivityRail = true')
    expect(appShellSource).toContain('<ActivityRail')
    expect(activityRailSource).toContain('label="自由对话"')
    expect(activityRailSource).toContain('label="项目"')
    expect(activityRailSource).toContain('text-[13px] font-semibold text-foreground/90')
    expect(activityRailSource).toContain('RECENT_SESSION_LIMIT = 8')
    expect(activityRailSource).toContain('listSessionsByWorkspace')
    expect(activityRailSource).toContain('onSelectSession')
    expect(activityRailSource).toContain('label="技能"')
    expect(activityRailSource).toContain('label="数据源"')
    expect(activityRailSource).toContain('label="搜索"')
    expect(activityRailSource).not.toContain('label="写作工作区"')
    expect(activityRailSource).not.toContain('dataTutorial="activity-writing"')
    expect(activityRailSource).toContain('aria-label="插件导航"')
    expect(activityRailSource).toContain('aria-label="个人菜单"')
    const skillsIndex = activityRailSource.indexOf('label="技能"')
    const sourcesIndex = activityRailSource.indexOf('label="数据源"')
    const searchIndex = activityRailSource.indexOf('label="搜索"')
    expect(skillsIndex).toBeLessThan(sourcesIndex)
    expect(sourcesIndex).toBeLessThan(searchIndex)
    expect(activityRailSource).not.toContain('{!isLibrary ? (')
    expect(appShellSource).toContain('onOpenSources={handleSourcesClick}')
    expect(appShellSource).toContain('onOpenSkills={handleSkillsClick}')
    expect(appShellSource).toContain('onOpenFreeConversations={onOpenFreeConversations}')
    expect(activityRailSource).not.toContain('dataTutorial="activity-free-conversations"')
  })

  it('keeps one profile item at the bottom and nests secondary actions inside it', () => {
    expect(activityRailSource).toContain('data-tutorial="activity-profile"')
    expect(activityRailSource).toContain('<DropdownMenuTrigger asChild>')
    expect(activityRailSource).toContain('账户')
    expect(activityRailSource).not.toContain('账户与积分')
    expect(activityRailSource).toContain('设置')
    expect(activityRailSource).toContain('新功能')
    expect(activityRailSource).toContain('帮助与反馈')
    expect(activityRailSource).not.toContain('aria-label="系统工具"')
    expect(activityRailSource).not.toContain('activity-check-updates')
    expect(appSource).toContain('profile={activityRailProfile}')
    expect(appShellSource).toContain('profile={profile}')
  })

  it('keeps the workspace rail flush with the bottom edge while insetting floating panels', () => {
    expect(appShellSource).toContain('data-testid="panel-stack-inset"')
    expect(appShellSource).toContain('paddingBottom: PANEL_EDGE_INSET, gap: PANEL_GAP')
    expect(activityRailSource).toContain('className="titlebar-no-drag flex h-full')
  })

  it('gives the project directory its own right-anchored column instead of nesting it in the rail', () => {
    // The directory used to replace the active project's row inside the rail,
    // conflating "project catalog" with "file tree". It is now the outermost
    // content navigator: a right-anchored ResizableColumn beside the manuscript.
    // So the rail no longer renders the directory at all.
    expect(appShellSource).toContain('const activityWorkspaceDirectory = showPrimarySidebar')
    expect(appShellSource).toContain('role="directory"')
    expect(appShellSource).toContain('sidebarSlot={null}')
    expect(appShellSource).toContain('sidebarWidth={0}')
    expect(activityRailSource).not.toContain('data-testid="activity-project-directory"')
    expect(activityRailSource).not.toContain('{workspaceDirectory}')
    expect(activityRailSource).toContain('projectWorkspaces.map((workspace) =>')
  })

  it('folds the whole project collection like recent conversations while preserving the native project root fold', () => {
    expect(activityRailSource).toContain('const [projectsExpanded, setProjectsExpanded]')
    expect(activityRailSource).toContain('storage.KEYS.activityProjectsExpanded')
    expect(activityRailSource).toContain('label="项目"')
    expect(activityRailSource).toContain('expanded={projectsExpanded}')
    expect(activityRailSource).toContain('{projectsExpanded ? (')
    expect(activityRailSource).toContain('data-testid="activity-sidebar-scroll"')
    expect(activityRailSource.match(/overflow-y-auto/g) ?? []).toHaveLength(1)
    expect(activityRailSource).toContain('overflow-x-hidden overflow-y-auto')
    expect(projectSidebarSource).toContain('fitContent')
    expect(activityRailSource).not.toContain('workspaceDirectoryExpanded')
    expect(activityRailSource).not.toContain('h-[min(44vh,420px)]')
  })

  it('keeps project disclosure separate from conversation selection', () => {
    const projectRowSource = activityRailSource.slice(
      activityRailSource.indexOf('function ProjectFolderRow'),
    )

    expect(projectRowSource).toContain('aria-expanded={expandable ? expanded : undefined}')
    expect(projectRowSource).toContain('onClick={() => onToggleExpanded?.()}')
    expect(projectRowSource).not.toContain('onSelect()')
    expect(activityRailSource).not.toContain('onSelectProject?:')
    expect(projectRowSource).not.toContain("role={expandable ? 'button' : undefined}")
    expect(projectRowSource).toContain("active && 'bg-foreground/[0.07] text-foreground'")
    expect(projectRowSource).toContain('aria-label={`在 ${workspace.name} 中新建对话`}')
    expect(appShellSource).toContain('await onSelectWorkspace(workspaceId)')
    expect(appShellSource).toContain('const session = await onCreateSession(workspaceId)')
    expect(appShellSource).toContain('await onSelectProjectSession(workspaceId, session.id)')
    expect(appShellSource).toContain('onCreateConversationInProject={handleActivityProjectSessionCreate}')
  })

  it('keeps the activity list stable while runtime content switches', () => {
    expect(activityRailSource).toContain('const activityExpandedProjectIdsAtom = atom<Set<string>>(new Set<string>())')
    expect(activityRailSource).toContain('useAtom(activityExpandedProjectIdsAtom)')
    expect(activityRailSource).toContain('useAtom(activityProjectSessionMetasAtom)')
    expect(activityRailSource).toContain('useAtom(activityShowAllRecentAtom)')
    expect(activityRailSource).toContain('useAtom(activityArchivedExpandedAtom)')
    expect(activityRailSource).toContain('activityStore.get(activitySidebarScrollTopAtom)')
    expect(activityRailSource).toContain('useAtomValue(freeRuntimeSessionMetasAtom)')
    expect(activityRailSource).not.toContain('useAtomValue(sessionMetaMapAtom)')
    expect(activityRailSource).toContain('if (freeSessionMetas === null) void refreshFreeSessionMetas()')
    expect(activityRailSource).not.toContain('[refreshFreeSessionMetas, workspaces]')
    expect(appSource).toContain("key={runtimeWorkspace?.id ?? 'no-runtime'}")
  })

  it('restores the shared conversation action menu in the activity rail', () => {
    expect(activityRailSource).toContain("import { SessionMenu } from './SessionMenu'")
    expect(activityRailSource).toContain('aria-label={`管理 ${getSessionTitle(meta)}`}')
    expect(activityRailSource).toContain('<SessionMenu')
    expect(appShellSource).toContain('onRename: onRenameSession')
    expect(appShellSource).toContain('onDelete: (sessionId) => { void handleDeleteSession(sessionId) }')
  })

  it('keeps global navigation usable from the project manager when an active project exists', () => {
    expect(appSource).toContain('const fallbackRuntimeWorkspaceId = useMemo(() =>')
    expect(appSource).toContain('workspace.id === FREE_CONVERSATION_WORKSPACE_ID')
    expect(appSource).toContain('const runtimeNavigationWorkspaceId = windowWorkspaceId')
    expect(appSource).toContain('?? activeProjectId')
    expect(appSource).toContain('?? fallbackRuntimeWorkspaceId')
    expect(appSource).toContain('const canOpenRuntimeNavigation = Boolean(runtimeNavigationWorkspaceId)')
    expect(appSource).toContain('const targetWorkspaceId = runtimeNavigationWorkspaceId')
    expect(appSource).toContain('onOpenSources: canOpenRuntimeNavigation')
    expect(appSource).toContain('onOpenSkills: canOpenRuntimeNavigation')
    expect(appSource).toContain('onOpenSearch: canOpenRuntimeNavigation ? handleOpenRuntimeSearch : undefined')
    expect(appSource).toContain('onOpenSettings: canOpenRuntimeNavigation')
    expect(appSource).toContain('onOpenWhatsNew: canOpenRuntimeNavigation ? handleOpenRuntimeWhatsNew : undefined')
    expect(appSource).toContain('openWhatsNewSignal={openWhatsNewSignal}')
    expect(appShellSource).toContain('if (openWhatsNewSignal > 0)')
  })

  it('opens a requested runtime route on the first click after activating a fallback project', () => {
    const pendingRouteEffect = appSource.slice(
      appSource.indexOf("if (appState !== 'ready' || !pendingReadyRoute) return"),
      appSource.indexOf('const openWorkspaceCreation')
    )

    expect(pendingRouteEffect).toContain('navigate(pendingReadyRoute)')
    expect(pendingRouteEffect).toContain('setPendingReadyRoute(null)')
    expect(pendingRouteEffect).not.toContain('requestAnimationFrame')
    expect(pendingRouteEffect).not.toContain('cancelAnimationFrame')
  })

  it('drops the redundant SessionList navigator now that the rail carries every domain', () => {
    // ADR 0006 revision: the rail is a two-level tree (Free Conversations plus
    // each project expanded into its own conversations), so the standalone
    // SessionList navigator column is redundant for every runtime — not just the
    // free one. Suppressing it also removes the empty column that used to sit
    // between the rail and the chat when a project had no open session.
    expect(appShellSource).toContain('const hideSessionListNavigator = showActivityRail')
    expect(appShellSource).not.toContain('&& !isProjectRuntime')
    expect(appShellSource).toContain('isProjectRuntime && isWritingNavigation(navState)')
    expect(appShellSource).toContain('isSessionsNavigation(navState) && (!showActivityRail || isAutoCompact)')
    expect(appShellSource).toContain('effectiveSidebarAndNavigatorHidden ? 0 : visibleSessionListWidth')
    expect(appShellSource).toContain('!effectiveSidebarAndNavigatorHidden && !hideSessionListNavigator')
  })

  it('uses the title bar only for window chrome and current project context', () => {
    expect(topBarSource).toContain('data-testid="window-title-bar"')
    expect(topBarSource).not.toContain('<WorkspaceSwitcher')
    expect(topBarSource).not.toContain('onOpenProjectHub')
  })

  it('remounts the runtime shell when the active room changes', () => {
    expect(appSource).toContain("key={runtimeWorkspace?.id ?? 'no-runtime'}")
    expect(appSource).toContain('<WorkspaceSurface')
  })
})
