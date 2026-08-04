// input: Workspace catalog, scoped session metadata, update status, shell callbacks, current profile, and window chrome inset
// output: Compact hierarchical sidebar with a workspace-aware task action, project conversations, updates, and profile navigation
// pos: Global navigation surface; every project subtree is fetched and selected through its own runtime domain (ADR 0006)

import * as React from 'react'
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  DatabaseZap,
  Download,
  HelpCircle,
  LoaderCircle,
  Megaphone,
  Settings,
  ShieldAlert,
  SquarePen,
  UserCircle,
  Zap,
} from 'lucide-react'
import appPackage from '../../../../package.json'
import { atom, useAtom, useAtomValue, useStore } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { RenameDialog } from '@/components/ui/rename-dialog'
import { CrossfadeAvatar } from '@/components/ui/avatar'
import { FeedbackDialog } from './FeedbackDialog'
import { ProjectSwitcherPopover } from './ProjectSwitcherPopover'
import {
  ProjectFolderRow,
  RecentConversationRow,
  type ActivityRailSessionActions,
} from './ActivityRailRows'
import {
  extractSessionMeta,
  sessionMetaMapAtom,
  sessionMetadataReadyAtom,
  type SessionMeta,
} from '@/atoms/sessions'
import { shouldRefreshGlobalSessionMetasForEvent } from '@/atoms/session-status-transition'
import * as storage from '@/lib/local-storage'
import { getSessionTitle } from '@/utils/session'
import { FREE_CONVERSATION_WORKSPACE_ID } from '@craft-agent/shared/protocol'
import { deriveSessionRuntimeStatus, requiresHumanAttention } from '@craft-agent/shared/statuses/runtime'
import { sessionIdsWithPendingPromptAtom } from '@/atoms/pending-requests'
import type { Workspace } from '../../../shared/types'
import { WINDOW_TITLE_BAR_HEIGHT } from './layout-constants'
import type { UpdateIndicatorState } from '@/lib/update-indicator'
import { useFocusActions } from '@/context/FocusContext'
import { useFocusZone } from '@/hooks/keyboard'

export type ActivityRailItemId =
  | 'recent'
  | 'writing'
  | 'sources'
  | 'skills'
  | 'settings'
  | 'search'
  | 'account'

export interface ActivityRailProps {
  activeItem: ActivityRailItemId
  workspaces?: Workspace[]
  /** Runtime whose local session atom is authoritative for immediate lifecycle updates. */
  runtimeWorkspaceId?: string | null
  activeWorkspaceId?: string | null
  activeSessionId?: string | null
  /**
   * Selects any conversation, free or project. The handler decides whether it is
   * an in-domain focus or an explicit cross-domain runtime switch (ADR 0006).
   */
  onSelectSession?: (sessionId: string, workspaceId: string) => void | Promise<void>
  /** The currently open project session, so its nested row can render as active. */
  activeProjectSessionId?: string | null
  onCreateConversationInProject?: (workspaceId: string) => void | Promise<void>
  onWorkspaceCreated?: (workspace: Workspace) => void | Promise<void>
  onOpenProjectInNewWindow?: (workspaceId: string) => void
  onRenameProject?: (workspaceId: string, name: string) => void | Promise<void>
  onSetProjectArchived?: (workspaceId: string, archived: boolean) => void | Promise<void>
  onRemoveProject?: (workspaceId: string) => void | Promise<void>
  /** Opens the free-conversation runtime and optionally creates a fresh conversation. */
  onOpenFreeConversations?: (options?: { createNew?: boolean }) => void | Promise<void>
  onOpenSources?: () => void
  onOpenSkills?: () => void
  onOpenSettings?: () => void
  onOpenAccount?: () => void
  profile?: {
    name: string
    detail?: string
    avatarUrl?: string
  }
  /** Optional release-notes surface inside the profile menu. */
  onOpenWhatsNew?: () => void
  whatsNew?: {
    unseen: boolean
    accentColor?: string
  }
  updateIndicator?: UpdateIndicatorState | null
  onInstallUpdate?: () => void | Promise<void>
  sessionActions?: ActivityRailSessionActions
}

export type { ActivityRailSessionActions } from './ActivityRailRows'

export const ACTIVITY_RAIL_WIDTH = 240
const RECENT_SESSION_LIMIT = 5
const PROJECT_WORKSPACE_LIMIT = 8
const activityFreeSessionMetasAtom = atom<SessionMeta[] | null>(null)
const activityExpandedProjectIdsAtom = atom<Set<string>>(new Set<string>())
const activityProjectSessionMetasAtom = atom<Record<string, SessionMeta[]>>({})
const activityActiveWorkspaceIdsAtom = atom<Set<string>>(new Set<string>())
const activityShowAllRecentAtom = atom(false)
const activityShowAllProjectsAtom = atom(false)
const activityArchivedExpandedAtom = atom(false)
const activitySidebarScrollTopAtom = atom(0)
const activityUnreadByWorkspaceAtom = atom<Record<string, boolean> | null>(null)
const runtimeSessionMetasAtom = selectAtom(
  sessionMetaMapAtom,
  (metas) => [...metas.values()],
  (left, right) => left.length === right.length && left.every((meta, index) => meta === right[index]),
)

export function resolveActivityWorkspaceSessionMetas(
  workspaceId: string,
  runtimeWorkspaceId: string | null | undefined,
  cachedMetas: readonly SessionMeta[] | undefined,
  runtimeMetas: readonly SessionMeta[],
  runtimeMetadataReady = true,
): readonly SessionMeta[] {
  return runtimeWorkspaceId === workspaceId && runtimeMetadataReady
    ? runtimeMetas.filter(meta => meta.workspaceId === workspaceId)
    : cachedMetas ?? []
}

export function ActivityRail({
  activeItem,
  workspaces = [],
  runtimeWorkspaceId = null,
  activeWorkspaceId = null,
  activeSessionId = null,
  onSelectSession,
  activeProjectSessionId = null,
  onCreateConversationInProject,
  onWorkspaceCreated,
  onOpenProjectInNewWindow,
  onRenameProject,
  onSetProjectArchived,
  onRemoveProject,
  onOpenFreeConversations,
  onOpenSources,
  onOpenSkills,
  onOpenSettings,
  onOpenAccount,
  profile,
  onOpenWhatsNew,
  whatsNew,
  updateIndicator,
  onInstallUpdate,
  sessionActions,
}: ActivityRailProps) {
  const { t } = useTranslation()
  const { focusZone } = useFocusActions()
  const { zoneRef: navigatorRef } = useFocusZone({ zoneId: 'navigator' })
  const activityStore = useStore()
  const scrollContainerRef = React.useRef<HTMLDivElement>(null)
  const localRuntimeSessionMetas = useAtomValue(runtimeSessionMetasAtom)
  const runtimeMetadataReady = useAtomValue(sessionMetadataReadyAtom)
  const sessionIdsWithPendingPrompt = useAtomValue(sessionIdsWithPendingPromptAtom)
  const [freeSessionMetas, setFreeSessionMetas] = useAtom(activityFreeSessionMetasAtom)
  const [unreadByWorkspace, setUnreadByWorkspace] = useAtom(activityUnreadByWorkspaceAtom)
  const [recentExpanded, setRecentExpanded] = React.useState(() => (
    storage.get(storage.KEYS.activityRecentExpanded, true)
  ))
  const [projectsExpanded, setProjectsExpanded] = React.useState(() => (
    storage.get(storage.KEYS.activityProjectsExpanded, true)
  ))
  const [archivedExpanded, setArchivedExpanded] = useAtom(activityArchivedExpandedAtom)
  const [showAllRecent, setShowAllRecent] = useAtom(activityShowAllRecentAtom)
  const [showAllProjects, setShowAllProjects] = useAtom(activityShowAllProjectsAtom)
  const [expandedProjectIds, setExpandedProjectIds] = useAtom(activityExpandedProjectIdsAtom)
  const [projectSessionMetas, setProjectSessionMetas] = useAtom(activityProjectSessionMetasAtom)
  const [activeWorkspaceIds, setActiveWorkspaceIds] = useAtom(activityActiveWorkspaceIdsAtom)
  const [loadingProjectIds, setLoadingProjectIds] = React.useState<Set<string>>(() => new Set())
  const [feedbackOpen, setFeedbackOpen] = React.useState(false)
  const [renameTarget, setRenameTarget] = React.useState<
    { kind: 'project' | 'session'; id: string; name: string } | null
  >(null)
  const [renameValue, setRenameValue] = React.useState('')
  const refreshGenerationRef = React.useRef(0)
  const activeRefreshGenerationRef = React.useRef(0)
  const canCreateProjects = typeof onWorkspaceCreated === 'function'
  const canCreateTask = Boolean(
    (activeWorkspaceId && onCreateConversationInProject)
    || onOpenFreeConversations,
  )
  const handleNavigatorFocus = React.useCallback(() => {
    // FocusContext intentionally does not track every focusin to avoid shell-wide
    // rerenders. The rail is the navigator zone when one of its controls is used.
    focusZone('navigator', { intent: 'click', moveFocus: false })
  }, [focusZone])
  let updateIndicatorLabel: string | null = null
  if (updateIndicator?.kind === 'downloading' && updateIndicator.version) {
    updateIndicatorLabel = t('settings.about.downloading', {
      version: updateIndicator.version,
      percent: updateIndicator.progress,
    })
  } else if (updateIndicator?.kind === 'ready' && updateIndicator.version) {
    updateIndicatorLabel = t('settings.about.restartToUpdate', { version: updateIndicator.version })
  } else if (updateIndicator?.kind === 'ready') {
    updateIndicatorLabel = t('settings.about.updateReady')
  } else if (updateIndicator?.kind === 'installing') {
    updateIndicatorLabel = t('toast.installingUpdate')
  }

  React.useLayoutEffect(() => {
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = activityStore.get(activitySidebarScrollTopAtom)
  }, [activityStore])

  const refreshFreeSessionMetas = React.useCallback(async () => {
    const generation = ++refreshGenerationRef.current
    try {
      const sessions = await window.electronAPI.listSessionsByWorkspace(FREE_CONVERSATION_WORKSPACE_ID)
      if (generation !== refreshGenerationRef.current) return
      setFreeSessionMetas(sessions.map(extractSessionMeta))
    } catch (error) {
      // Older remote servers may not expose the scoped metadata endpoint yet.
      // Rendering nothing is the honest fallback: the previous cross-workspace
      // fallback leaked project conversations into this list.
      console.warn('[activity-sidebar] Failed to load free conversation metadata:', error)
    }
  }, [setFreeSessionMetas])

  const refreshProjectSessionMetas = React.useCallback(async (workspaceId: string) => {
    setLoadingProjectIds((prev) => {
      const next = new Set(prev)
      next.add(workspaceId)
      return next
    })
    try {
      const sessions = await window.electronAPI.listSessionsByWorkspace(workspaceId)
      const metas = sessions
        .map(extractSessionMeta)
        .filter((meta) => !meta.hidden && meta.isArchived !== true)
        .sort((left, right) => (right.lastMessageAt ?? right.createdAt ?? 0) - (left.lastMessageAt ?? left.createdAt ?? 0))
      setProjectSessionMetas((prev) => ({ ...prev, [workspaceId]: metas }))
    } catch (error) {
      console.warn('[activity-sidebar] Failed to load project conversations:', workspaceId, error)
      setProjectSessionMetas((prev) => ({ ...prev, [workspaceId]: [] }))
    } finally {
      setLoadingProjectIds((prev) => {
        const next = new Set(prev)
        next.delete(workspaceId)
        return next
      })
    }
  }, [setProjectSessionMetas])

  const toggleProjectExpanded = React.useCallback((workspaceId: string) => {
    setExpandedProjectIds((prev) => {
      const next = new Set(prev)
      if (next.has(workspaceId)) {
        next.delete(workspaceId)
      } else {
        next.add(workspaceId)
        void refreshProjectSessionMetas(workspaceId)
      }
      return next
    })
  }, [refreshProjectSessionMetas, setExpandedProjectIds])

  const refreshUnreadSummary = React.useCallback(async () => {
    try {
      setUnreadByWorkspace((await window.electronAPI.getUnreadSummary()).hasUnreadByWorkspace)
    } catch (error) {
      console.warn('[activity-sidebar] Failed to load unread summary:', error)
    }
  }, [setUnreadByWorkspace])

  const refreshActiveWorkspaceIds = React.useCallback(async () => {
    const generation = ++activeRefreshGenerationRef.current
    try {
      const activeSessions = await window.electronAPI.getActiveSessions()
      if (generation !== activeRefreshGenerationRef.current) return
      setActiveWorkspaceIds(new Set(activeSessions.map(session => session.workspaceId)))
    } catch (error) {
      if (generation === activeRefreshGenerationRef.current) setActiveWorkspaceIds(new Set())
      console.warn('[activity-sidebar] Failed to load active session summary:', error)
    }
  }, [setActiveWorkspaceIds])

  React.useEffect(() => {
    if (freeSessionMetas === null) void refreshFreeSessionMetas()
  }, [freeSessionMetas, refreshFreeSessionMetas])

  React.useEffect(() => {
    void refreshActiveWorkspaceIds()
  }, [refreshActiveWorkspaceIds])

  // The aggregate summary keeps collapsed project rows honest without loading
  // or merging their session identities; expanded lists remain workspace-scoped.
  React.useEffect(() => {
    if (activityStore.get(activityUnreadByWorkspaceAtom) === null) void refreshUnreadSummary()
    return window.electronAPI.onUnreadSummaryChanged((summary) => {
      setUnreadByWorkspace(summary.hasUnreadByWorkspace)
    })
  }, [activityStore, refreshUnreadSummary, setUnreadByWorkspace])

  React.useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = window.electronAPI.onSessionEvent((event) => {
      if (!shouldRefreshGlobalSessionMetasForEvent(event.type)) return
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        void refreshFreeSessionMetas()
        void refreshActiveWorkspaceIds()
        for (const workspaceId of expandedProjectIds) {
          void refreshProjectSessionMetas(workspaceId)
        }
      }, 180)
    })

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      unsubscribe()
    }
  }, [expandedProjectIds, refreshActiveWorkspaceIds, refreshFreeSessionMetas, refreshProjectSessionMetas])

  const sessionMetas = React.useMemo(() => {
    return [...resolveActivityWorkspaceSessionMetas(
      FREE_CONVERSATION_WORKSPACE_ID,
      runtimeWorkspaceId,
      freeSessionMetas ?? undefined,
      localRuntimeSessionMetas,
      runtimeMetadataReady,
    )]
      .filter(meta => !meta.hidden && meta.isArchived !== true)
      .sort((left, right) => (right.lastMessageAt ?? right.createdAt ?? 0) - (left.lastMessageAt ?? left.createdAt ?? 0))
  }, [freeSessionMetas, localRuntimeSessionMetas, runtimeMetadataReady, runtimeWorkspaceId])

  const recentSessions = showAllRecent
    ? sessionMetas
    : sessionMetas.slice(0, RECENT_SESSION_LIMIT)
  const hasMoreRecentSessions = sessionMetas.length > RECENT_SESSION_LIMIT
  // Aggregated over every session, not just the visible slice: a collapsed or
  // truncated group must still reveal that something inside needs a human.
  const recentNeedsAttention = React.useMemo(
    () => sessionMetas.some(meta => requiresHumanAttention(deriveSessionRuntimeStatus({
      isProcessing: meta.isProcessing,
      hasPendingPrompt: sessionIdsWithPendingPrompt.has(meta.id),
      lastMessageRole: meta.lastMessageRole,
    }))),
    [sessionIdsWithPendingPrompt, sessionMetas]
  )
  const projectWorkspaces = React.useMemo(
    () => [...workspaces]
      .filter(workspace => (
        workspace.id !== FREE_CONVERSATION_WORKSPACE_ID
        && !workspace.archivedAt
      ))
      .sort((left, right) => {
        const recentOrder = (right.lastAccessedAt ?? 0) - (left.lastAccessedAt ?? 0)
        return recentOrder || left.name.localeCompare(right.name, 'zh-Hans')
      }),
    [workspaces],
  )
  const archivedWorkspaces = React.useMemo(
    () => workspaces
      .filter(workspace => (
        workspace.id !== FREE_CONVERSATION_WORKSPACE_ID
        && Boolean(workspace.archivedAt)
      ))
      .sort((left, right) => (right.archivedAt ?? 0) - (left.archivedAt ?? 0)),
    [workspaces],
  )
  const visibleProjectWorkspaces = showAllProjects
    ? projectWorkspaces
    : projectWorkspaces.slice(0, PROJECT_WORKSPACE_LIMIT)
  const hasMoreProjectWorkspaces = projectWorkspaces.length > PROJECT_WORKSPACE_LIMIT

  const updateRecentExpanded = React.useCallback((expanded: boolean) => {
    setRecentExpanded(expanded)
    storage.set(storage.KEYS.activityRecentExpanded, expanded)
  }, [])

  const updateProjectsExpanded = React.useCallback((expanded: boolean) => {
    setProjectsExpanded(expanded)
    storage.set(storage.KEYS.activityProjectsExpanded, expanded)
  }, [])

  const handleCreateTask = React.useCallback(() => {
    if (activeWorkspaceId && onCreateConversationInProject) {
      void onCreateConversationInProject(activeWorkspaceId)
      return
    }

    void onOpenFreeConversations?.({ createNew: true })
  }, [activeWorkspaceId, onCreateConversationInProject, onOpenFreeConversations])

  const projectCreateTrigger = (
    <button
      type="button"
      aria-label="新建本地项目"
      title="新建本地项目"
      data-tutorial="activity-project-hub"
      className="flex h-6 w-6 items-center justify-center rounded-[6px] text-muted-foreground opacity-0 outline-none transition-[color,background-color,opacity] hover:bg-foreground/[0.06] hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 focus-visible:ring-1 focus-visible:ring-ring"
    >
      <SquarePen className="h-3.5 w-3.5" />
    </button>
  )

  return (
    <aside
      ref={navigatorRef}
      tabIndex={-1}
      onFocus={handleNavigatorFocus}
      data-testid="activity-rail"
      aria-label="工作区导航"
      className="titlebar-no-drag flex h-full shrink-0 flex-col border-r border-foreground/[0.06] bg-foreground-1.5 font-medium"
      style={{ width: ACTIVITY_RAIL_WIDTH }}
    >
      {/* Window-pinned collapse/search controls sit above this draggable title-bar area. */}
      <div
        aria-hidden="true"
        className="titlebar-drag-region shrink-0"
        style={{ height: WINDOW_TITLE_BAR_HEIGHT }}
      />
      <div className="flex min-h-0 flex-1 flex-col px-2 pt-1">
        <div className="flex items-center px-2.5 pb-2">
          <span className="min-w-0 flex-1 truncate text-[16px] font-medium text-foreground/85">
            Storyflow
            <span className="ml-1 text-[11px] font-normal text-muted-foreground/65">v{appPackage.version}</span>
          </span>
        </div>

        <button
          type="button"
          aria-label="新建任务"
          disabled={!canCreateTask}
          className={cn(
            'mb-0.5 flex h-8 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-[13px] font-medium text-foreground/90 outline-none transition-colors',
            'hover:bg-foreground/[0.045] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring',
            'disabled:cursor-default disabled:opacity-45',
          )}
          onClick={handleCreateTask}
        >
          <SquarePen className="h-4 w-4" />
          <span>新建任务</span>
        </button>

        <nav className="shrink-0 space-y-0.5 pb-4" aria-label="插件导航">
          <SidebarNavItem
            label="技能"
            icon={<Zap className="h-4 w-4" />}
            active={activeItem === 'skills'}
            disabled={!onOpenSkills}
            onClick={onOpenSkills}
            dataTutorial="activity-skills"
          />
          <SidebarNavItem
            label="数据源"
            icon={<DatabaseZap className="h-4 w-4" />}
            active={activeItem === 'sources'}
            disabled={!onOpenSources}
            onClick={onOpenSources}
            dataTutorial="activity-sources"
          />
        </nav>

        <div
          ref={scrollContainerRef}
          onScroll={(event) => activityStore.set(activitySidebarScrollTopAtom, event.currentTarget.scrollTop)}
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-0.5"
          data-testid="activity-sidebar-scroll"
        >
          <section aria-label="自由对话">
            <SidebarSectionHeader
              label="自由对话"
              count={sessionMetas.length}
              expanded={recentExpanded}
              needsAttention={recentNeedsAttention}
              onToggle={() => updateRecentExpanded(!recentExpanded)}
              action={onOpenFreeConversations ? (
                <button
                  type="button"
                  aria-label="新建自由对话"
                  title="新建自由对话"
                  className="flex h-6 w-6 items-center justify-center rounded-[6px] text-muted-foreground opacity-0 outline-none transition-[color,background-color,opacity] hover:bg-foreground/[0.06] hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={() => { void onOpenFreeConversations({ createNew: true }) }}
                >
                  <SquarePen className="h-3.5 w-3.5" />
                </button>
              ) : undefined}
            />
            {recentExpanded ? (
              <div
                className="space-y-0.5 pb-3"
                data-testid="activity-recent-sessions"
              >
                {recentSessions.length > 0 ? recentSessions.map(meta => (
                  <RecentConversationRow
                    key={meta.id}
                    meta={meta}
                    active={activeSessionId === meta.id}
                    disabled={!onSelectSession}
                    onSelect={() => onSelectSession?.(meta.id, meta.workspaceId)}
                    sessionActions={sessionActions}
                    onRename={() => {
                      setRenameTarget({ kind: 'session', id: meta.id, name: getSessionTitle(meta) })
                      setRenameValue(getSessionTitle(meta))
                    }}
                  />
                )) : (
                  <div className="px-3 py-3 text-xs text-muted-foreground/60">暂无自由对话</div>
                )}
                {hasMoreRecentSessions ? (
                  <button
                    type="button"
                    className="mt-1 w-full rounded-[7px] px-3 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.045] hover:text-foreground"
                    onClick={() => setShowAllRecent(value => !value)}
                  >
                    {showAllRecent ? '收起对话' : `显示全部 ${sessionMetas.length} 个自由对话`}
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>

          <section aria-label="项目目录">
            <SidebarSectionHeader
              label="项目"
              count={projectWorkspaces.length}
              expanded={projectsExpanded}
              onToggle={() => updateProjectsExpanded(!projectsExpanded)}
              action={canCreateProjects ? (
                <ProjectSwitcherPopover
                  onWorkspaceCreated={onWorkspaceCreated}
                >
                  {projectCreateTrigger}
                </ProjectSwitcherPopover>
              ) : undefined}
            />
            {projectsExpanded ? (
              projectWorkspaces.length > 0 ? (
                <>
                  <div className="space-y-0.5 pb-1" data-testid="activity-projects">
                    {visibleProjectWorkspaces.map((workspace) => {
                      const expanded = expandedProjectIds.has(workspace.id)
                      return (
                        <ProjectFolderRow
                          key={workspace.id}
                          workspace={workspace}
                          active={activeWorkspaceId === workspace.id && !activeProjectSessionId}
                          hasUnread={unreadByWorkspace?.[workspace.id] === true}
                          hasActiveSession={activeWorkspaceIds.has(workspace.id)}
                          disabled={!onSelectSession}
                          expandable={Boolean(onSelectSession)}
                          expanded={expanded}
                          onToggleExpanded={() => toggleProjectExpanded(workspace.id)}
                          sessions={[...resolveActivityWorkspaceSessionMetas(
                            workspace.id,
                            runtimeWorkspaceId,
                            projectSessionMetas[workspace.id],
                            localRuntimeSessionMetas,
                            runtimeMetadataReady,
                          )]
                            .filter(meta => !meta.hidden && meta.isArchived !== true)
                            .sort((left, right) => (right.lastMessageAt ?? right.createdAt ?? 0) - (left.lastMessageAt ?? left.createdAt ?? 0))}
                          loadingSessions={loadingProjectIds.has(workspace.id)}
                          activeSessionId={activeWorkspaceId === workspace.id ? activeProjectSessionId : null}
                          onSelectSession={onSelectSession
                            ? (sessionId) => { void onSelectSession(sessionId, workspace.id) }
                            : undefined}
                          onCreateConversation={onCreateConversationInProject
                            ? () => onCreateConversationInProject(workspace.id)
                            : undefined}
                          sessionActions={sessionActions}
                          onRenameSession={(meta) => {
                            setRenameTarget({ kind: 'session', id: meta.id, name: getSessionTitle(meta) })
                            setRenameValue(getSessionTitle(meta))
                          }}
                          onOpenInNewWindow={onOpenProjectInNewWindow
                            ? () => onOpenProjectInNewWindow(workspace.id)
                            : undefined}
                          onRename={onRenameProject
                            ? () => {
                              setRenameTarget({ kind: 'project', id: workspace.id, name: workspace.name })
                              setRenameValue(workspace.name)
                            }
                            : undefined}
                          onArchive={onSetProjectArchived
                            ? () => onSetProjectArchived(workspace.id, true)
                            : undefined}
                        />
                      )
                    })}
                  </div>
                  {hasMoreProjectWorkspaces ? (
                    <button
                      type="button"
                      className="mb-1 w-full rounded-[7px] px-3 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.045] hover:text-foreground"
                      onClick={() => setShowAllProjects(value => !value)}
                    >
                      {showAllProjects ? '收起项目' : `显示全部 ${projectWorkspaces.length} 个项目`}
                    </button>
                  ) : null}
                </>
              ) : (
                <div className="px-3 py-3 text-xs text-muted-foreground/60">暂无项目</div>
              )
            ) : null}
            {archivedWorkspaces.length > 0 ? (
              <>
                <SidebarSectionHeader
                  label={`已归档 ${archivedWorkspaces.length}`}
                  expanded={archivedExpanded}
                  onToggle={() => setArchivedExpanded(value => !value)}
                />
                {archivedExpanded ? (
                  <div className="space-y-0.5 pb-1" data-testid="activity-archived-projects">
                    {archivedWorkspaces.map(workspace => (
                      <ProjectFolderRow
                        key={workspace.id}
                        workspace={workspace}
                        active={false}
                        archived
                        hasUnread={false}
                        disabled
                        onRestore={onSetProjectArchived
                          ? () => onSetProjectArchived(workspace.id, false)
                          : undefined}
                        onRemove={onRemoveProject
                          ? () => {
                            const ok = window.confirm(`从列表中移除「${workspace.name}」？不会删除磁盘文件。`)
                            if (ok) void onRemoveProject(workspace.id)
                          }
                          : undefined}
                      />
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </section>
        </div>
      </div>

      <div className="border-t border-border/35 px-2 py-2">
        {updateIndicator ? (
          <div aria-live="polite">
            <button
              type="button"
              disabled={!updateIndicator.actionable}
              aria-label={updateIndicatorLabel ?? undefined}
              data-tutorial="activity-update"
              className={cn(
                'mb-1.5 flex w-full items-center gap-2 rounded-[8px] px-2 py-2 text-left text-[12px] font-medium outline-none transition-colors',
                updateIndicator.actionable
                  ? 'bg-info/10 text-[var(--info-text)] hover:bg-info/15 focus-visible:ring-1 focus-visible:ring-info'
                  : 'cursor-default bg-foreground/[0.035] text-muted-foreground',
              )}
              onClick={() => {
                if (updateIndicator.actionable) void onInstallUpdate?.()
              }}
            >
              {updateIndicator.kind === 'ready' ? (
                <Download className="size-4 shrink-0" aria-hidden="true" />
              ) : (
                <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1 truncate">{updateIndicatorLabel}</span>
            </button>
          </div>
        ) : null}
        <nav aria-label="个人菜单">
          <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${profile?.name ?? '本地用户'}的个人菜单`}
              data-tutorial="activity-profile"
              className={cn(
                'flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left outline-none transition-colors',
                'hover:bg-foreground/[0.045] focus-visible:ring-1 focus-visible:ring-ring',
                (activeItem === 'account' || activeItem === 'settings') && 'bg-foreground/[0.07]',
              )}
            >
              {profile?.avatarUrl ? (
                <CrossfadeAvatar
                  src={profile.avatarUrl}
                  alt={`${profile.name}的头像`}
                  className="size-7 rounded-full"
                  fallbackClassName="rounded-full bg-foreground/10 text-[11px] font-semibold text-foreground/80"
                  fallback={getProfileInitial(profile.name)}
                />
              ) : (
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[11px] font-semibold text-foreground/80">
                  {getProfileInitial(profile?.name)}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium leading-4 text-foreground/90">
                  {profile?.name ?? '本地用户'}
                </span>
                {profile?.detail ? (
                  <span className="block truncate text-[10px] leading-4 text-muted-foreground/65">
                    {profile.detail}
                  </span>
                ) : null}
              </span>
              {whatsNew?.unseen ? (
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: whatsNew.accentColor ?? 'var(--accent)' }}
                  aria-label="有未读新功能"
                />
              ) : null}
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent side="top" align="start" sideOffset={6} className="w-[236px]">
            {onOpenAccount ? (
              <StyledDropdownMenuItem onClick={onOpenAccount} data-tutorial="activity-account">
                <UserCircle className="size-4" />
                账户
              </StyledDropdownMenuItem>
            ) : null}
            {onOpenAccount ? <StyledDropdownMenuSeparator /> : null}
            <StyledDropdownMenuItem
              disabled={!onOpenSettings}
              onClick={onOpenSettings}
              data-tutorial="activity-settings"
            >
              <Settings className="size-4" />
              设置
            </StyledDropdownMenuItem>
            <StyledDropdownMenuItem
              disabled={!onOpenWhatsNew}
              onClick={onOpenWhatsNew}
              data-tutorial="activity-whats-new"
            >
              <Megaphone className="size-4" />
              <span className="min-w-0 flex-1">
                {whatsNew?.unseen ? '新功能（未读）' : '新功能'}
              </span>
              {whatsNew?.unseen ? (
                <span
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: whatsNew.accentColor ?? 'var(--accent)' }}
                  aria-hidden="true"
                />
              ) : null}
            </StyledDropdownMenuItem>
            <StyledDropdownMenuItem
              onClick={() => window.electronAPI.openUrl('https://ehyg6a9wjd.feishu.cn/docx/MC49dYJYtoRnalxgYi1ceH01nWb')}
              data-tutorial="activity-beginner-guide"
            >
              <BookOpen className="size-4" />
              新手教程
            </StyledDropdownMenuItem>
            <StyledDropdownMenuItem
              onClick={() => setFeedbackOpen(true)}
              data-tutorial="activity-feedback"
            >
              <HelpCircle className="size-4" />
              帮助与反馈
            </StyledDropdownMenuItem>
          </StyledDropdownMenuContent>
          </DropdownMenu>
          <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
        </nav>
      </div>
      {renameTarget ? (
        <RenameDialog
          open
          onOpenChange={(open) => {
            if (!open) setRenameTarget(null)
          }}
          title={renameTarget.kind === 'project' ? '重命名项目' : '重命名对话'}
          value={renameValue}
          onValueChange={setRenameValue}
          onSubmit={() => {
            const nextName = renameValue.trim()
            if (nextName && nextName !== renameTarget.name) {
              if (renameTarget.kind === 'project') {
                void onRenameProject?.(renameTarget.id, nextName)
              } else {
                setFreeSessionMetas((metas) => metas?.map((meta) => (
                  meta.id === renameTarget.id ? { ...meta, name: nextName } : meta
                )) ?? null)
                setProjectSessionMetas((byWorkspace) => Object.fromEntries(
                  Object.entries(byWorkspace).map(([workspaceId, metas]) => [
                    workspaceId,
                    metas.map((meta) => (
                      meta.id === renameTarget.id ? { ...meta, name: nextName } : meta
                    )),
                  ]),
                ))
                sessionActions?.onRename(renameTarget.id, nextName)
              }
            }
            setRenameTarget(null)
          }}
          placeholder={renameTarget.kind === 'project' ? '输入项目名称' : '输入对话名称'}
        />
      ) : null}
    </aside>
  )
}

function SidebarNavItem({
  label,
  icon,
  active,
  onClick,
  dataTutorial,
  disabled,
}: {
  label: string
  icon: React.ReactNode
  active: boolean
  onClick?: () => void
  dataTutorial?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      disabled={disabled}
      data-tutorial={dataTutorial}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-[13px] outline-none transition-colors',
        'text-foreground/75 hover:bg-foreground/[0.045] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring',
        'disabled:cursor-default disabled:opacity-45',
        active && 'bg-foreground/[0.07] font-medium text-foreground',
      )}
      onClick={onClick}
    >
      <span className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center',
        'text-muted-foreground',
      )}>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  )
}

function SidebarSectionHeader({
  label,
  count,
  expanded,
  onToggle,
  action,
  needsAttention,
}: {
  label: string
  count?: number
  expanded: boolean
  onToggle: () => void
  action?: React.ReactNode
  /** Shows an indicator when a collapsed group hides sessions awaiting a human. */
  needsAttention?: boolean
}) {
  return (
    <div className="group flex items-center justify-between rounded-[7px] transition-colors hover:bg-foreground/[0.045] focus-within:bg-foreground/[0.045]">
      <button
        type="button"
        aria-expanded={expanded}
        className="flex min-w-0 flex-1 items-center gap-1 rounded-[7px] px-2 py-1.5 text-left text-[12px] font-medium text-muted-foreground/80 outline-none transition-colors group-hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
        onClick={onToggle}
      >
        <span className="min-w-0 truncate">
          {label}
          {count !== undefined ? <span className="ml-1 font-normal">({count})</span> : null}
        </span>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-55 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-55 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />
        )}
        {needsAttention && !expanded ? (
          <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-info" aria-label="有对话等待处理" />
        ) : null}
      </button>
      {action}
    </div>
  )
}

function getProfileInitial(name: string | undefined): string {
  const normalized = name?.trim()
  return normalized ? Array.from(normalized)[0].toLocaleUpperCase() : '本'
}
