// input: AppShell, panel chrome, ActivityRail row primitives, WorkspaceProjectSidebar, and project-creation source
// output: Static regression for rail-owned project management IA and compact visual hierarchy
// pos: Project browsing is rail-only; dialogs are reserved for creation forms

import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const appShellSource = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8')
const topBarPath = fileURLToPath(new URL('../TopBar.tsx', import.meta.url))
const panelHeaderSource = readFileSync(new URL('../PanelHeader.tsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8')
const activityRailPath = fileURLToPath(new URL('../ActivityRail.tsx', import.meta.url))
const activityRailSource = readFileSync(activityRailPath, 'utf8')
const activityRailRowsSource = readFileSync(new URL('../ActivityRailRows.tsx', import.meta.url), 'utf8')
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
    expect(activityRailSource).toContain('aria-label="新建本地项目"')
    expect(activityRailSource).not.toContain('aria-label="项目"')
    expect(appShellSource).not.toContain('<TopBar')
  })

  it('opens the single local project form directly', () => {
    expect(existsSync(projectManagerPath)).toBe(true)
    expect(projectManagerSource).toContain('data-testid="project-manager-panel"')
    expect(projectManagerSource).toContain('创建本地项目')
    expect(projectManagerSource).toContain('名称可选，留空时使用文件夹名称。')
    expect(projectManagerSource).not.toContain('导入文件夹')
    expect(projectManagerSource).not.toContain('连接远端')
    expect(projectManagerSource).not.toContain('选择写作方法')
    expect(projectManagerSource).not.toContain('最近项目')
    expect(projectManagerSource).not.toContain('重命名')
    expect(projectManagerSource).not.toContain('移除')
    expect(projectManagerSource).not.toContain('新窗口打开')
    expect(projectManagerSource).toContain('<AddWorkspaceStep_CreateNew')
    expect(projectManagerSource).not.toContain('AddWorkspaceStep_OpenFolder')
    expect(projectManagerSource).not.toContain('AddWorkspaceStep_ConnectRemote')
    expect(projectManagerSource).toContain('embedded')
    expect(projectSwitcherSource).toContain('<ProjectManagerPanel')
    expect(projectSwitcherSource).toContain('<Dialog')
    expect(projectSwitcherSource).toContain('<DialogTrigger')
    expect(projectSwitcherSource).not.toContain('<DropdownMenu')
    expect(projectSwitcherSource).not.toContain("setView(")
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
    expect(activityRailRowsSource).toContain('<span>归档</span>')
    expect(activityRailRowsSource).toContain('<span>恢复</span>')
    expect(activityRailSource).not.toContain('onCreateProject')
    expect(activityRailSource).not.toContain('onManageProjects')
    expect(activityRailSource).not.toContain('退出到作品库')
  })

  it('offers conversation ID copying from the rail context menu', () => {
    expect(activityRailRowsSource).toContain('navigator.clipboard.writeText(meta.id)')
    expect(activityRailRowsSource).toContain('复制对话 ID')
  })

  it('keeps plugin navigation at the top of the single workspace sidebar', () => {
    expect(appShellSource).toContain('const showActivityRail = true')
    expect(appShellSource).toContain('<ActivityRail')
    expect(activityRailSource).toContain('label="自由对话"')
    expect(activityRailSource).toContain('label="项目"')
    expect(activityRailSource).toContain('text-[12px] font-medium text-muted-foreground/80')
    expect(activityRailSource).toContain('RECENT_SESSION_LIMIT = 5')
    expect(activityRailSource).toContain('PROJECT_WORKSPACE_LIMIT = 8')
    expect(activityRailSource).toContain('listSessionsByWorkspace')
    expect(activityRailSource).toContain('onSelectSession')
    expect(activityRailSource).toContain('label="技能"')
    expect(activityRailSource).toContain('label="数据源"')
    expect(activityRailSource).not.toContain('aria-label="搜索"')
    expect(activityRailSource).not.toContain('aria-label="收起侧边栏"')
    expect(appShellSource).toContain('data-testid="activity-rail-titlebar-actions"')
    expect(appShellSource).toContain('aria-label="搜索"')
    expect(appShellSource).toContain("aria-label={isActivityRailVisible ? '收起侧边栏' : '展开侧边栏'}")
    expect(appShellSource).toContain('aria-expanded={isActivityRailVisible}')
    expect(appShellSource).not.toContain('data-testid="activity-rail-collapsed"')
    expect(activityRailSource).not.toContain('label="写作工作区"')
    expect(activityRailSource).not.toContain('dataTutorial="activity-writing"')
    expect(activityRailSource).toContain('aria-label="插件导航"')
    expect(activityRailSource).toContain('aria-label="个人菜单"')
    const createConversationIndex = activityRailSource.indexOf('aria-label="新建任务"')
    const skillsIndex = activityRailSource.indexOf('label="技能"')
    const sourcesIndex = activityRailSource.indexOf('label="数据源"')
    expect(createConversationIndex).toBeLessThan(skillsIndex)
    expect(skillsIndex).toBeLessThan(sourcesIndex)
    const collapseIndex = appShellSource.indexOf("aria-label={isActivityRailVisible ? '收起侧边栏' : '展开侧边栏'}")
    const searchIndex = appShellSource.indexOf('data-tutorial="activity-search"')
    expect(collapseIndex).toBeGreaterThan(-1)
    expect(searchIndex).toBeGreaterThan(collapseIndex)
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
    expect(activityRailSource).toContain('visibleProjectWorkspaces.map((workspace) =>')
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
    const sectionHeaderSource = activityRailSource.slice(
      activityRailSource.indexOf('function SidebarSectionHeader'),
      activityRailSource.indexOf('function getProfileInitial'),
    )
    const projectRowSource = activityRailRowsSource.slice(
      activityRailRowsSource.indexOf('export function ProjectFolderRow'),
    )

    expect(projectRowSource).toContain('aria-expanded={expandable ? expanded : undefined}')
    expect(projectRowSource).toContain('onClick={() => onToggleExpanded?.()}')
    expect(projectRowSource).not.toContain('onSelect()')
    expect(activityRailSource).not.toContain('onSelectProject?:')
    expect(projectRowSource).not.toContain("role={expandable ? 'button' : undefined}")
    expect(projectRowSource).toContain("active && 'bg-foreground/[0.07] text-foreground'")
    expect(projectRowSource).toContain("'group flex min-w-0 items-center rounded-[6px] hover:bg-foreground/[0.045]'")
    expect(projectRowSource).toContain('aria-label={`在 ${workspace.name} 中新建任务`}')
    expect(activityRailRowsSource).toContain('const PROJECT_SESSION_LIMIT = 5')
    expect(projectRowSource).toContain('sessions?.slice(0, PROJECT_SESSION_LIMIT)')
    expect(projectRowSource).toContain("{showAllSessions ? '收起显示' : '展开显示'}")
    expect(projectRowSource).toContain('<FolderOpen')
    expect(activityRailRowsSource).toContain("nested ? 'py-1.5 pl-[30px] pr-2'")
    expect(sectionHeaderSource).toContain('<div className="group flex items-center justify-between rounded-[7px]')
    expect(sectionHeaderSource).toContain('opacity-55 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100')
    expect(activityRailSource).toContain('group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100')
    expect(sectionHeaderSource.indexOf('{label}')).toBeLessThan(sectionHeaderSource.indexOf('{expanded ?'))
    expect(projectRowSource).toContain('role="status">正在加载对话…')
    expect(activityRailRowsSource).toContain('animate-spin text-muted-foreground/75')
    expect(activityRailSource).toContain('window.electronAPI.getActiveSessions()')
    expect(projectRowSource).toContain("aria-label={loadingSessions ? '正在加载对话' : '项目中有对话正在运行'}")
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
    expect(activityRailSource).toContain('useAtom(activityShowAllProjectsAtom)')
    expect(activityRailSource).toContain('useAtom(activityArchivedExpandedAtom)')
    expect(activityRailSource).toContain('activityStore.get(activitySidebarScrollTopAtom)')
    expect(activityRailSource).toContain('useAtomValue(runtimeSessionMetasAtom)')
    expect(activityRailSource).not.toContain('useAtomValue(sessionMetaMapAtom)')
    expect(activityRailSource).toContain('if (freeSessionMetas === null) void refreshFreeSessionMetas()')
    expect(activityRailSource).not.toContain('[refreshFreeSessionMetas, workspaces]')
    expect(appSource).not.toContain("key={runtimeWorkspace?.id ?? 'no-runtime'}")
    expect(appShellSource).toContain('previousWorkspaceId !== activeWorkspaceId')
    expect(appShellSource).toContain('setSources([])')
    expect(appShellSource).toContain('setSkills([])')
  })

  it('keeps rail conversation actions in a small right-click menu', () => {
    const conversationRowSource = activityRailRowsSource.slice(
      activityRailRowsSource.indexOf('export function RecentConversationRow'),
      activityRailRowsSource.indexOf('export function ProjectFolderRow'),
    )

    expect(activityRailSource).not.toContain("import { SessionMenu } from './SessionMenu'")
    expect(conversationRowSource).toContain('<ContextMenuTrigger asChild>{row}</ContextMenuTrigger>')
    expect(conversationRowSource).toContain('重命名')
    expect(conversationRowSource).toContain('归档')
    expect(conversationRowSource).toContain('删除')
    expect(conversationRowSource).not.toContain('<DropdownMenu')
    expect(conversationRowSource).not.toContain('MoreHorizontal')
    expect(conversationRowSource).not.toContain('<SessionMenu')
    expect(conversationRowSource).toContain("'flex w-full min-w-0 items-center rounded-[6px] hover:bg-foreground/[0.045]'")
    expect(appShellSource).toContain('onRename: onRenameSession')
    expect(appShellSource).toContain('onArchive: onArchiveSession')
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
    expect(appShellSource).toContain('const hideSessionListNavigator = isSkillsNavigation(navState)')
    expect(appShellSource).not.toContain('&& !isProjectRuntime')
    expect(appShellSource).toContain('isProjectRuntime && isWritingNavigation(navState)')
    expect(appShellSource).toContain('isSessionsNavigation(navState) && (!showActivityRail || isAutoCompact)')
    expect(appShellSource).toContain('effectiveSidebarAndNavigatorHidden ? 0 : visibleSessionListWidth')
    expect(appShellSource).toContain('!effectiveSidebarAndNavigatorHidden && !hideSessionListNavigator')
  })

  it('removes the duplicate project title strip and uses panel headers as window chrome', () => {
    expect(existsSync(topBarPath)).toBe(false)
    expect(appShellSource).not.toContain('<TopBar')
    expect(panelHeaderSource).toContain('titlebar-drag-region')
  })

  it('keeps the runtime shell mounted and defers hidden writing catalogs', () => {
    expect(appSource).not.toContain("key={runtimeWorkspace?.id ?? 'no-runtime'}")
    expect(appSource).toContain('<WorkspaceSurface')
    expect(appShellSource).toContain('if (!rightWorkspaceVisible) {')
    expect(appShellSource).toContain('invalidateWorkspaceSkillsCache(workspaceId)')
    expect(appShellSource).toContain('if (!cancelled) setSkills(loaded || [])')
  })
})
