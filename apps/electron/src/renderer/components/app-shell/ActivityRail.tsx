// input: Workspace catalog, active project directory, free-conversation session metadata, unread summary, shell navigation callbacks, and current profile
// output: Single Codex-style sidebar listing Free Conversations plus collapsible projects and one profile menu
// pos: Global navigation surface owning the free-conversation runtime domain; project conversations stay in project chrome (ADR 0006)

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
  Trash2,
  UserCircle,
  Zap,
} from 'lucide-react'
import { useAtomValue } from 'jotai'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { RenameDialog } from '@/components/ui/rename-dialog'
import { FeedbackDialog } from './FeedbackDialog'
import { ProjectSwitcherPopover } from './ProjectSwitcherPopover'
import {
  extractSessionMeta,
  sessionMetaMapAtom,
  type SessionMeta,
} from '@/atoms/sessions'
import { shouldRefreshGlobalSessionMetasForEvent } from '@/atoms/session-status-transition'
import { formatRelativeTimestamp } from '@/lib/display-format'
import * as storage from '@/lib/local-storage'
import { getSessionTitle } from '@/utils/session'
import { FREE_CONVERSATION_WORKSPACE_ID } from '@craft-agent/shared/protocol'
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
  onSelectProject?: (workspaceId: string) => void
  onSelectSession?: (sessionId: string, workspaceId: string) => void | Promise<void>
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
  /** Active writing project's directory tree, rendered inside its project node. */
  workspaceDirectory?: React.ReactNode
  /** Optional release-notes surface inside the profile menu. */
  onOpenWhatsNew?: () => void
  whatsNew?: {
    unseen: boolean
    accentColor?: string
  }
}

export const ACTIVITY_RAIL_WIDTH = 252
const RECENT_SESSION_LIMIT = 8

export function ActivityRail({
  activeItem,
  workspaces = [],
  activeWorkspaceId = null,
  activeSessionId = null,
  onSelectProject,
  onSelectSession,
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
  workspaceDirectory,
  onOpenWhatsNew,
  whatsNew,
}: ActivityRailProps) {
  const localSessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const [freeSessionMetas, setFreeSessionMetas] = React.useState<SessionMeta[] | null>(null)
  const [unreadByWorkspace, setUnreadByWorkspace] = React.useState<Record<string, boolean>>({})
  const [recentExpanded, setRecentExpanded] = React.useState(() => (
    storage.get(storage.KEYS.activityRecentExpanded, true)
  ))
  const [projectsExpanded, setProjectsExpanded] = React.useState(() => (
    storage.get(storage.KEYS.activityProjectsExpanded, true)
  ))
  const [archivedExpanded, setArchivedExpanded] = React.useState(false)
  const [showAllRecent, setShowAllRecent] = React.useState(false)
  const [feedbackOpen, setFeedbackOpen] = React.useState(false)
  const [renameTarget, setRenameTarget] = React.useState<Workspace | null>(null)
  const [renameValue, setRenameValue] = React.useState('')
  const refreshGenerationRef = React.useRef(0)
  const canCreateProjects = typeof onWorkspaceCreated === 'function'

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
  }, [])

  const refreshUnreadSummary = React.useCallback(async () => {
    try {
      setUnreadByWorkspace((await window.electronAPI.getUnreadSummary()).hasUnreadByWorkspace)
    } catch (error) {
      console.warn('[activity-sidebar] Failed to load unread summary:', error)
    }
  }, [])

  React.useEffect(() => {
    void refreshFreeSessionMetas()
  }, [refreshFreeSessionMetas, workspaces])

  // Project unread state comes from the aggregate summary rather than the
  // conversation list: the rail lists Free Conversations only, but it still
  // renders an unread dot per project row. The summary carries counts keyed by
  // workspace, never session identities, so it crosses no ownership boundary.
  React.useEffect(() => {
    void refreshUnreadSummary()
    return window.electronAPI.onUnreadSummaryChanged((summary) => {
      setUnreadByWorkspace(summary.hasUnreadByWorkspace)
    })
  }, [refreshUnreadSummary])

  React.useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = window.electronAPI.onSessionEvent((event) => {
      if (!shouldRefreshGlobalSessionMetasForEvent(event.type)) return
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        void refreshFreeSessionMetas()
      }, 180)
    })

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      unsubscribe()
    }
  }, [refreshFreeSessionMetas])

  const sessionMetas = React.useMemo(() => {
    const merged = new Map<string, SessionMeta>()
    for (const meta of freeSessionMetas ?? []) merged.set(meta.id, meta)
    // Overlay the active workspace's live atom state so optimistic title/read/
    // processing updates are reflected before the next metadata refresh. That
    // atom is scoped to whichever workspace is running, so it must be filtered
    // back down to the free domain — otherwise the open project's sessions
    // reappear here regardless of what the server returned.
    for (const meta of localSessionMetaMap.values()) {
      if (meta.workspaceId !== FREE_CONVERSATION_WORKSPACE_ID) continue
      merged.set(meta.id, meta)
    }
    return [...merged.values()]
      .filter(meta => !meta.hidden && meta.isArchived !== true)
      .sort((left, right) => (right.lastMessageAt ?? right.createdAt ?? 0) - (left.lastMessageAt ?? left.createdAt ?? 0))
  }, [freeSessionMetas, localSessionMetaMap])

  const recentSessions = showAllRecent
    ? sessionMetas
    : sessionMetas.slice(0, RECENT_SESSION_LIMIT)
  const hasMoreRecentSessions = sessionMetas.length > RECENT_SESSION_LIMIT
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
      className="titlebar-no-drag flex h-full shrink-0 flex-col border-r border-border/35 bg-background/80"
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
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-0.5"
          data-testid="activity-sidebar-scroll"
        >
          <section aria-label="自由对话">
            <SidebarSectionHeader
              label="自由对话"
              expanded={recentExpanded}
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
                    const showsActiveDirectory = Boolean(
                      workspaceDirectory && workspace.id === activeWorkspaceId,
                    )
                    return showsActiveDirectory ? (
                      <div
                        key={workspace.id}
                        data-testid="activity-project-directory"
                        className="min-w-0 overflow-hidden pl-3.5"
                      >
                        {workspaceDirectory}
                      </div>
                    ) : (
                      <ProjectFolderRow
                        key={workspace.id}
                        workspace={workspace}
                        active={activeWorkspaceId === workspace.id}
                        hasUnread={unreadByWorkspace[workspace.id] === true}
                        disabled={!onSelectProject}
                        onSelect={() => onSelectProject?.(workspace.id)}
                        onOpenInNewWindow={onOpenProjectInNewWindow
                          ? () => onOpenProjectInNewWindow(workspace.id)
                          : undefined}
                        onRename={onRenameProject
                          ? () => {
                            setRenameTarget(workspace)
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
                        onSelect={() => {}}
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
          title="重命名项目"
          value={renameValue}
          onValueChange={setRenameValue}
          onSubmit={() => {
            const nextName = renameValue.trim()
            if (nextName && nextName !== renameTarget.name) {
              void onRenameProject?.(renameTarget.id, nextName)
            }
            setRenameTarget(null)
          }}
          placeholder="输入项目名称"
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
}: {
  label: string
  expanded: boolean
  onToggle: () => void
  action?: React.ReactNode
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
        <span>{label}</span>
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
}: {
  meta: SessionMeta
  active: boolean
  disabled: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-label={getSessionTitle(meta)}
      aria-current={active ? 'page' : undefined}
      disabled={disabled}
      data-session-id={meta.id}
      className={cn(
        'group flex w-full min-w-0 items-center gap-1.5 rounded-[6px] px-2 py-2 text-left outline-none transition-colors',
        'hover:bg-foreground/[0.045] focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60',
        active && 'bg-foreground/[0.07] text-foreground',
      )}
      onClick={onSelect}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
        <span className={cn(
          'h-1.5 w-1.5 rounded-full bg-transparent',
          meta.hasUnread && 'bg-accent',
          meta.isProcessing && 'animate-pulse bg-foreground/50',
        )} />
      </span>
      <MessageSquareText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-[12px] leading-4 text-foreground/90">
        {getSessionTitle(meta)}
      </span>
      <span className="shrink-0 text-[10px] text-muted-foreground/55">{formatRelativeTimestamp(meta.lastMessageAt, '')}</span>
    </button>
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
  onSelect,
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
  onSelect: () => void
  onOpenInNewWindow?: () => void
  onRename?: () => void
  onArchive?: () => void
  onRestore?: () => void
  onRemove?: () => void
}) {
  return (
    <div className="group flex min-w-0 items-center rounded-[6px] hover:bg-foreground/[0.045]">
      <button
        type="button"
        aria-label={`项目：${workspace.name}`}
        title={workspace.name}
        aria-current={active ? 'page' : undefined}
        disabled={disabled}
        className={cn(
          'flex h-[30px] min-w-0 flex-1 items-center gap-1.5 rounded-[6px] px-2 text-left outline-none transition-colors',
          'focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default',
          active && 'bg-foreground/[0.07] text-foreground',
          archived && 'opacity-60',
        )}
        onClick={onSelect}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        </span>
        <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/85">{workspace.name}</span>
        {hasUnread ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label="有未读对话" /> : null}
      </button>
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
  )
}
