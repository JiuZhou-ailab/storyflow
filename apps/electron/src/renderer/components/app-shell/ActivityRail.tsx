// input: Workspace catalog, workspace-scoped session metadata, unread summary, shell callbacks, and current profile
// output: Single Codex-style sidebar listing Free Conversations plus collapsible project conversation subtrees
// pos: Global navigation surface; every project subtree is fetched and selected through its own runtime domain (ADR 0006)

import * as React from 'react'
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  DatabaseZap,
  Folder,
  HelpCircle,
  Megaphone,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings,
  ShieldAlert,
  Trash2,
  UserCircle,
  Zap,
} from 'lucide-react'
import { atom, useAtom, useAtomValue, useStore } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { DropdownMenuProvider } from '@/components/ui/menu-context'
import { RenameDialog } from '@/components/ui/rename-dialog'
import { FeedbackDialog } from './FeedbackDialog'
import { ProjectSwitcherPopover } from './ProjectSwitcherPopover'
import { SessionMenu } from './SessionMenu'
import {
  extractSessionMeta,
  sessionMetaMapAtom,
  type SessionMeta,
} from '@/atoms/sessions'
import type { SessionStatus, SessionStatusId } from '@/config/session-status-config'
import type { LabelConfig } from '@craft-agent/shared/labels'
import { shouldRefreshGlobalSessionMetasForEvent } from '@/atoms/session-status-transition'
import { formatRelativeTimestamp } from '@/lib/display-format'
import * as storage from '@/lib/local-storage'
import { getSessionTitle } from '@/utils/session'
import { FREE_CONVERSATION_WORKSPACE_ID } from '@craft-agent/shared/protocol'
import { deriveSessionRuntimeStatus, requiresHumanAttention } from '@craft-agent/shared/statuses/runtime'
import { hasPendingPromptAtomFamily, sessionIdsWithPendingPromptAtom } from '@/atoms/pending-requests'
import type { Workspace } from '../../../shared/types'

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
  /** Opens the free-conversation runtime for the new-conversation affordance. */
  onOpenFreeConversations?: () => void | Promise<void>
  onOpenSources?: () => void
  onOpenSkills?: () => void
  onOpenSearch?: () => void
  onOpenSettings?: () => void
  onOpenAccount?: () => void
  profile?: {
    name: string
    detail?: string
  }
  /** Optional release-notes surface inside the profile menu. */
  onOpenWhatsNew?: () => void
  whatsNew?: {
    unseen: boolean
    accentColor?: string
  }
  sessionActions?: ActivityRailSessionActions
}

export interface ActivityRailSessionActions {
  configurationWorkspaceId?: string | null
  sessionStatuses: SessionStatus[]
  labels?: LabelConfig[]
  onLabelsChange?: (sessionId: string, labels: string[]) => void
  onRename: (sessionId: string, name: string) => void
  onFlag: (sessionId: string) => void
  onUnflag: (sessionId: string) => void
  onArchive: (sessionId: string) => void
  onUnarchive: (sessionId: string) => void
  onMarkUnread: (sessionId: string) => void
  onSessionStatusChange: (sessionId: string, state: SessionStatusId) => void
  onOpenInNewWindow: (session: SessionMeta) => void
  onSendToWorkspace?: (sessionId: string) => void
  onDelete: (sessionId: string) => void
  hasRemoteWorkspaces?: boolean
}

export const ACTIVITY_RAIL_WIDTH = 252
const RECENT_SESSION_LIMIT = 8
const activityFreeSessionMetasAtom = atom<SessionMeta[] | null>(null)
const activityExpandedProjectIdsAtom = atom<Set<string>>(new Set<string>())
const activityProjectSessionMetasAtom = atom<Record<string, SessionMeta[]>>({})
const activityShowAllRecentAtom = atom(false)
const activityArchivedExpandedAtom = atom(false)
const activitySidebarScrollTopAtom = atom(0)
const activityUnreadByWorkspaceAtom = atom<Record<string, boolean> | null>(null)
const freeRuntimeSessionMetasAtom = selectAtom(
  sessionMetaMapAtom,
  (metas) => [...metas.values()].filter((meta) => meta.workspaceId === FREE_CONVERSATION_WORKSPACE_ID),
  (left, right) => left.length === right.length && left.every((meta, index) => meta === right[index]),
)

export function ActivityRail({
  activeItem,
  workspaces = [],
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
  onOpenSearch,
  onOpenSettings,
  onOpenAccount,
  profile,
  onOpenWhatsNew,
  whatsNew,
  sessionActions,
}: ActivityRailProps) {
  const activityStore = useStore()
  const scrollContainerRef = React.useRef<HTMLDivElement>(null)
  const localFreeSessionMetas = useAtomValue(freeRuntimeSessionMetasAtom)
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
  const [expandedProjectIds, setExpandedProjectIds] = useAtom(activityExpandedProjectIdsAtom)
  const [projectSessionMetas, setProjectSessionMetas] = useAtom(activityProjectSessionMetasAtom)
  const [loadingProjectIds, setLoadingProjectIds] = React.useState<Set<string>>(() => new Set())
  const [feedbackOpen, setFeedbackOpen] = React.useState(false)
  const [renameTarget, setRenameTarget] = React.useState<
    { kind: 'project' | 'session'; id: string; name: string } | null
  >(null)
  const [renameValue, setRenameValue] = React.useState('')
  const refreshGenerationRef = React.useRef(0)
  const canCreateProjects = typeof onWorkspaceCreated === 'function'

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

  React.useEffect(() => {
    if (freeSessionMetas === null) void refreshFreeSessionMetas()
  }, [freeSessionMetas, refreshFreeSessionMetas])

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
        for (const workspaceId of expandedProjectIds) {
          void refreshProjectSessionMetas(workspaceId)
        }
      }, 180)
    })

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      unsubscribe()
    }
  }, [expandedProjectIds, refreshFreeSessionMetas, refreshProjectSessionMetas])

  const sessionMetas = React.useMemo(() => {
    const merged = new Map<string, SessionMeta>()
    for (const meta of freeSessionMetas ?? []) merged.set(meta.id, meta)
    // Overlay the active workspace's live atom state so optimistic title/read/
    // processing updates are reflected before the next metadata refresh. That
    // atom is scoped to whichever workspace is running, so it must be filtered
    // back down to the free domain — otherwise the open project's sessions
    // reappear here regardless of what the server returned.
    for (const meta of localFreeSessionMetas) {
      merged.set(meta.id, meta)
    }
    return [...merged.values()]
      .filter(meta => !meta.hidden && meta.isArchived !== true)
      .sort((left, right) => (right.lastMessageAt ?? right.createdAt ?? 0) - (left.lastMessageAt ?? left.createdAt ?? 0))
  }, [freeSessionMetas, localFreeSessionMetas])

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

  const updateRecentExpanded = React.useCallback((expanded: boolean) => {
    setRecentExpanded(expanded)
    storage.set(storage.KEYS.activityRecentExpanded, expanded)
  }, [])

  const updateProjectsExpanded = React.useCallback((expanded: boolean) => {
    setProjectsExpanded(expanded)
    storage.set(storage.KEYS.activityProjectsExpanded, expanded)
  }, [])

  const projectCreateTrigger = (
    <button
      type="button"
      aria-label="新建或导入项目"
      title="新建或导入项目"
      data-tutorial="activity-project-hub"
      className="flex h-7 w-7 items-center justify-center rounded-[7px] text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
    >
      <Plus className="h-4 w-4" />
    </button>
  )

  return (
    <aside
      data-testid="activity-rail"
      aria-label="工作区导航"
      className="titlebar-no-drag flex h-full shrink-0 flex-col border-r border-foreground/[0.09] bg-background/80"
      style={{ width: ACTIVITY_RAIL_WIDTH }}
    >
      <div className="flex min-h-0 flex-1 flex-col px-2 pt-2">
        <div className="flex items-center px-2 pb-2">
          <span className="text-[12px] font-semibold tracking-wide text-foreground/75">工作区</span>
        </div>

        <nav className="shrink-0 space-y-0.5 pb-3" aria-label="插件导航">
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
          <SidebarNavItem
            label="搜索"
            icon={<Search className="h-4 w-4" />}
            active={activeItem === 'search'}
            disabled={!onOpenSearch}
            onClick={onOpenSearch}
            dataTutorial="activity-search"
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
              expanded={recentExpanded}
              needsAttention={recentNeedsAttention}
              onToggle={() => updateRecentExpanded(!recentExpanded)}
              action={onOpenFreeConversations ? (
                <button
                  type="button"
                  aria-label="新建自由对话"
                  title="新建自由对话"
                  className="flex h-7 w-7 items-center justify-center rounded-[7px] text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={() => { void onOpenFreeConversations() }}
                >
                  <Plus className="h-4 w-4" />
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
                <div className="space-y-0.5 pb-1" data-testid="activity-projects">
                  {projectWorkspaces.map((workspace) => {
                    const expanded = expandedProjectIds.has(workspace.id)
                    return (
                      <ProjectFolderRow
                        key={workspace.id}
                        workspace={workspace}
                        active={activeWorkspaceId === workspace.id}
                        hasUnread={unreadByWorkspace?.[workspace.id] === true}
                        disabled={!onSelectSession}
                        expandable={Boolean(onSelectSession)}
                        expanded={expanded}
                        onToggleExpanded={() => toggleProjectExpanded(workspace.id)}
                        sessions={projectSessionMetas[workspace.id]}
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

      <nav className="border-t border-border/35 px-2 py-2" aria-label="个人菜单">
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
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[11px] font-semibold text-foreground/80">
                {getProfileInitial(profile?.name)}
              </span>
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
        'flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-left text-[12px] outline-none transition-colors',
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
  expanded,
  onToggle,
  action,
  needsAttention,
}: {
  label: string
  expanded: boolean
  onToggle: () => void
  action?: React.ReactNode
  /** Shows an indicator when a collapsed group hides sessions awaiting a human. */
  needsAttention?: boolean
}) {
  return (
    <div className="flex items-center justify-between px-1">
      <button
        type="button"
        aria-expanded={expanded}
        className="flex min-w-0 flex-1 items-center gap-1 rounded-[7px] px-2 py-1.5 text-left text-[13px] font-semibold text-foreground/90 outline-none transition-colors hover:bg-foreground/[0.045] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
        onClick={onToggle}
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <span className="min-w-0 truncate">{label}</span>
        {needsAttention && !expanded ? (
          <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-info" aria-label="有对话等待处理" />
        ) : null}
      </button>
      {action}
    </div>
  )
}

function RecentConversationRow({
  meta,
  active,
  disabled,
  onSelect,
  sessionActions,
  onRename,
}: {
  meta: SessionMeta
  active: boolean
  disabled: boolean
  onSelect: () => void
  sessionActions?: ActivityRailSessionActions
  onRename: () => void
}) {
  const hasPendingPrompt = useAtomValue(hasPendingPromptAtomFamily(meta.id))
  const runtimeStatus = deriveSessionRuntimeStatus({
    isProcessing: meta.isProcessing,
    hasPendingPrompt,
    lastMessageRole: meta.lastMessageRole,
  })
  const usesCurrentConfiguration = (
    !sessionActions?.configurationWorkspaceId
    || sessionActions.configurationWorkspaceId === meta.workspaceId
  )
  return (
    <div
      data-session-id={meta.id}
      className={cn(
        'group flex w-full min-w-0 items-center rounded-[6px] transition-colors hover:bg-foreground/[0.045]',
        active && 'bg-foreground/[0.07] text-foreground',
      )}
    >
      <button
        type="button"
        aria-label={getSessionTitle(meta)}
        aria-current={active ? 'page' : undefined}
        disabled={disabled}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[6px] px-2 py-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60"
        onClick={onSelect}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
          <span className={cn(
            'h-1.5 w-1.5 rounded-full bg-transparent',
            meta.hasUnread && 'bg-accent',
            runtimeStatus === 'running' && 'animate-pulse bg-foreground/50',
            runtimeStatus === 'waiting-input' && 'bg-info',
            runtimeStatus === 'error' && 'bg-destructive',
          )} />
        </span>
        <MessageSquareText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[12px] leading-4 text-foreground/90">
          {getSessionTitle(meta)}
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground/55">{formatRelativeTimestamp(meta.lastMessageAt, '')}</span>
      </button>
      {sessionActions ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`管理 ${getSessionTitle(meta)}`}
              className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-foreground/[0.06] hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent align="end" sideOffset={4}>
            <DropdownMenuProvider>
              <SessionMenu
                item={meta}
                sessionStatuses={usesCurrentConfiguration ? sessionActions.sessionStatuses : []}
                labels={usesCurrentConfiguration ? sessionActions.labels : []}
                onLabelsChange={usesCurrentConfiguration && sessionActions.onLabelsChange
                  ? (labels) => sessionActions.onLabelsChange?.(meta.id, labels)
                  : undefined}
                onRename={onRename}
                onFlag={() => sessionActions.onFlag(meta.id)}
                onUnflag={() => sessionActions.onUnflag(meta.id)}
                onArchive={() => sessionActions.onArchive(meta.id)}
                onUnarchive={() => sessionActions.onUnarchive(meta.id)}
                onMarkUnread={() => sessionActions.onMarkUnread(meta.id)}
                onSessionStatusChange={(state) => sessionActions.onSessionStatusChange(meta.id, state)}
                onOpenInNewWindow={() => sessionActions.onOpenInNewWindow(meta)}
                onSendToWorkspace={sessionActions.onSendToWorkspace
                  ? () => sessionActions.onSendToWorkspace?.(meta.id)
                  : undefined}
                onDelete={() => sessionActions.onDelete(meta.id)}
                hasRemoteWorkspaces={sessionActions.hasRemoteWorkspaces}
              />
            </DropdownMenuProvider>
          </StyledDropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}

function getProfileInitial(name: string | undefined): string {
  const normalized = name?.trim()
  return normalized ? Array.from(normalized)[0].toLocaleUpperCase() : '本'
}

function ProjectFolderRow({
  workspace,
  active,
  archived = false,
  hasUnread,
  disabled,
  expandable = false,
  expanded = false,
  onToggleExpanded,
  sessions,
  loadingSessions = false,
  activeSessionId = null,
  onSelectSession,
  onCreateConversation,
  sessionActions,
  onRenameSession,
  onOpenInNewWindow,
  onRename,
  onArchive,
  onRestore,
  onRemove,
}: {
  workspace: Workspace
  active: boolean
  archived?: boolean
  hasUnread: boolean
  disabled: boolean
  expandable?: boolean
  expanded?: boolean
  onToggleExpanded?: () => void
  sessions?: SessionMeta[]
  loadingSessions?: boolean
  activeSessionId?: string | null
  onSelectSession?: (sessionId: string) => void
  onCreateConversation?: () => void | Promise<void>
  sessionActions?: ActivityRailSessionActions
  onRenameSession?: (meta: SessionMeta) => void
  onOpenInNewWindow?: () => void
  onRename?: () => void
  onArchive?: () => void
  onRestore?: () => void
  onRemove?: () => void
}) {
  return (
    <div>
    <div className={cn(
      'group flex min-w-0 items-center rounded-[6px] transition-colors hover:bg-foreground/[0.045]',
      active && 'bg-foreground/[0.07] text-foreground',
    )}>
      <button
        type="button"
        aria-label={`项目：${workspace.name}`}
        title={workspace.name}
        aria-current={active ? 'page' : undefined}
        aria-expanded={expandable ? expanded : undefined}
        disabled={disabled}
        className={cn(
          'flex h-[30px] min-w-0 flex-1 items-center gap-1.5 rounded-[6px] px-2 text-left outline-none',
          'focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default',
          archived && 'opacity-60',
        )}
        onClick={() => onToggleExpanded?.()}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
          {expanded
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </span>
        <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/85">{workspace.name}</span>
        {hasUnread ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label="有未读对话" /> : null}
      </button>
      {onCreateConversation ? (
        <button
          type="button"
          aria-label={`在 ${workspace.name} 中新建对话`}
          title="新建对话"
          className="flex size-7 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => { void onCreateConversation() }}
        >
          <Plus className="size-3.5" />
        </button>
      ) : null}
      {(onOpenInNewWindow || onRename || onArchive || onRestore || onRemove) ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`管理 ${workspace.name}`}
              className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-foreground/[0.06] hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent align="end" sideOffset={4}>
            {onOpenInNewWindow ? (
              <StyledDropdownMenuItem onClick={onOpenInNewWindow}>
                <ArrowUpRight className="size-3.5" />
                <span>新窗口打开</span>
              </StyledDropdownMenuItem>
            ) : null}
            {onRename ? (
              <StyledDropdownMenuItem onClick={onRename}>
                <Pencil className="size-3.5" />
                <span>重命名</span>
              </StyledDropdownMenuItem>
            ) : null}
            {onArchive ? (
              <StyledDropdownMenuItem onClick={onArchive}>
                <Archive className="size-3.5" />
                <span>归档</span>
              </StyledDropdownMenuItem>
            ) : null}
            {onRestore ? (
              <StyledDropdownMenuItem onClick={onRestore}>
                <ArchiveRestore className="size-3.5" />
                <span>恢复</span>
              </StyledDropdownMenuItem>
            ) : null}
            {onRemove ? <StyledDropdownMenuSeparator /> : null}
            {onRemove ? (
              <StyledDropdownMenuItem variant="destructive" onClick={onRemove}>
                <Trash2 className="size-3.5" />
                <span>移除</span>
              </StyledDropdownMenuItem>
            ) : null}
          </StyledDropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
    {expandable && expanded ? (
      <div className="ml-[18px] mt-0.5 space-y-0.5 border-l border-border/40 pl-1.5" data-testid="activity-project-conversations">
        {loadingSessions && !sessions ? (
          <div className="px-2 py-1.5 text-[11px] text-muted-foreground/60">正在加载对话…</div>
        ) : sessions && sessions.length > 0 ? (
          sessions.map((meta) => (
            <RecentConversationRow
              key={meta.id}
              meta={meta}
              active={activeSessionId === meta.id}
              disabled={!onSelectSession}
              onSelect={() => onSelectSession?.(meta.id)}
              sessionActions={sessionActions}
              onRename={() => onRenameSession?.(meta)}
            />
          ))
        ) : (
          <div className="px-2 py-1.5 text-[11px] text-muted-foreground/60">暂无对话</div>
        )}
      </div>
    ) : null}
    </div>
  )
}
