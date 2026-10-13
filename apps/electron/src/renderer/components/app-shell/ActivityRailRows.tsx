// input: Ordered session/workspace metadata, project disclosure state, runtime indicators, and row callbacks
// output: Session/project rows (with unavailable-reason hover and shared dropdown/right-click actions) and conversation-creation feedback with retry
// pos: Visual primitives for ActivityRail; owns row grouping, interaction affordances, and context actions

import * as React from 'react'
import type { TFunction } from 'i18next'
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  Copy,
  Folder,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  ShieldAlert,
  SquarePen,
  Trash2,
} from 'lucide-react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { getFileManagerName } from '@/lib/platform'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
  StyledContextMenuSeparator,
} from '@/components/ui/styled-context-menu'
import type { SessionMeta } from '@/atoms/sessions'
import { hasPendingPromptAtomFamily } from '@/atoms/pending-requests'
import { formatRelativeTimestamp } from '@/lib/display-format'
import { getSessionTitle } from '@/utils/session'
import { deriveSessionRuntimeStatus } from '@craft-agent/shared/statuses/runtime'
import type { Workspace } from '../../../shared/types'
import { partitionSessionMetas } from './activity-rail-session-order'

const PROJECT_SESSION_LIMIT = 5

export async function createConversationWithFeedback(create: () => Promise<void>, t: TFunction): Promise<void> {
  try {
    await create()
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    toast.error(code === 'SESSION_STORAGE_BUSY'
      ? t('sessions.create.storageBusy')
      : t('sessions.create.failed'), {
      action: { label: t('common.retry'), onClick: () => createConversationWithFeedback(create, t) },
    })
  }
}

export interface ActivityRailSessionActions {
  onRename: (sessionId: string, name: string, workspaceId: string) => void | Promise<void>
  onArchive: (sessionId: string, workspaceId: string) => void | Promise<void>
  onDelete: (sessionId: string, workspaceId: string) => void | Promise<void>
  onPin?: (sessionId: string, workspaceId: string) => Promise<boolean>
  onUnpin?: (sessionId: string, workspaceId: string) => Promise<boolean>
}

export interface ActivityRailSessionDragHandlers {
  draggingSessionId: string | null
  onDragStart: (event: React.DragEvent<HTMLElement>, meta: SessionMeta) => void
  onDragEnd: () => void
  onDropOnSession: (event: React.DragEvent<HTMLElement>, target: SessionMeta) => void
  onDropOnGroup: (event: React.DragEvent<HTMLElement>, fixed: boolean) => void
}

export function RecentConversationRow({
  meta,
  active,
  disabled,
  onSelect,
  sessionActions,
  onRename,
  nested = false,
  dragHandlers,
}: {
  meta: SessionMeta
  active: boolean
  disabled: boolean
  onSelect: () => void
  sessionActions?: ActivityRailSessionActions
  onRename: () => void
  nested?: boolean
  dragHandlers?: ActivityRailSessionDragHandlers
}) {
  const hasPendingPrompt = useAtomValue(hasPendingPromptAtomFamily(meta.id))
  const runtimeStatus = deriveSessionRuntimeStatus({
    isProcessing: meta.isProcessing,
    hasPendingPrompt,
    lastMessageRole: meta.lastMessageRole,
  })
  const isRunning = runtimeStatus === 'running'
  const showStatus = isRunning
    || runtimeStatus === 'waiting-input'
    || runtimeStatus === 'error'
    || meta.hasUnread
  const statusIndicator = isRunning ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/75" />
  ) : (
    <span className={cn(
      'h-1.5 w-1.5 rounded-full',
      meta.hasUnread && 'bg-accent',
      runtimeStatus === 'waiting-input' && 'bg-info',
      runtimeStatus === 'error' && 'bg-destructive',
    )} />
  )
  const statusLabel = isRunning
    ? '正在运行'
    : runtimeStatus === 'waiting-input'
      ? '等待处理'
      : runtimeStatus === 'error'
        ? '运行出错'
        : meta.hasUnread
          ? '未读'
          : null
  // Titles stay left-aligned: only real status occupies the trailing marker slot.
  const row = (
    <div
      data-session-id={meta.id}
      data-session-fixed={meta.isPinned ? 'true' : 'false'}
      onDragOver={dragHandlers ? event => event.preventDefault() : undefined}
      onDrop={dragHandlers ? event => dragHandlers.onDropOnSession(event, meta) : undefined}
      className={cn(
        'group/session-row flex w-full min-w-0 items-center rounded-[6px] hover:bg-foreground/[0.045]',
        dragHandlers?.draggingSessionId === meta.id && 'opacity-45',
        active && 'bg-foreground/[0.07] text-foreground',
      )}
    >
      <button
        type="button"
        aria-label={getSessionTitle(meta)}
        aria-current={active ? 'page' : undefined}
        disabled={disabled}
        draggable={!disabled && Boolean(dragHandlers)}
        data-session-drag-handle={dragHandlers ? 'true' : undefined}
        onDragStart={dragHandlers ? event => dragHandlers.onDragStart(event, meta) : undefined}
        onDragEnd={dragHandlers?.onDragEnd}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-1.5 rounded-[6px] text-left outline-none',
          'focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60',
          nested ? 'py-1.5 pl-[30px] pr-2' : 'px-2 py-1.5',
        )}
        onClick={onSelect}
      >
        <span className="min-w-0 flex-1 truncate text-left text-[13px] leading-4 text-foreground/85">
          {getSessionTitle(meta)}
        </span>
        {statusLabel ? <span className="sr-only">{statusLabel}</span> : null}
        {showStatus ? (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">{statusIndicator}</span>
        ) : null}
        {!nested ? (
          <span className={cn('shrink-0 text-[11px] leading-4 text-muted-foreground/70', sessionActions && 'group-hover/session-row:hidden group-focus-within/session-row:hidden')}>{formatRelativeTimestamp(meta.lastMessageAt, '')}</span>
        ) : null}
      </button>
      {sessionActions ? (
        <div className="hidden shrink-0 items-center gap-0.5 pr-1 group-hover/session-row:flex group-focus-within/session-row:flex">
          {(meta.isPinned ? sessionActions.onUnpin : sessionActions.onPin) ? (
            <button
              type="button"
              data-session-action="pin"
              title={meta.isPinned ? '取消固定' : '固定会话'}
              aria-label={meta.isPinned ? '取消固定' : '固定会话'}
              disabled={disabled}
              className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
              onClick={() => { void (meta.isPinned ? sessionActions.onUnpin : sessionActions.onPin)?.(meta.id, meta.workspaceId) }}
            >
              {meta.isPinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
            </button>
          ) : null}
          <button
            type="button"
            data-session-action="archive"
            title="归档聊天"
            aria-label="归档聊天"
            disabled={disabled}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            onClick={() => sessionActions.onArchive(meta.id, meta.workspaceId)}
          >
            <Archive className="size-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  )

  const handleCopySessionId = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(meta.id)
      toast.success('已复制到剪贴板')
    } catch {
      toast.error('复制失败')
    }
  }, [meta.id])

  const rowWithActions = sessionActions ? (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <StyledContextMenuContent>
        <StyledContextMenuItem onSelect={onRename}>
          <Pencil className="h-3.5 w-3.5" />
          重命名
        </StyledContextMenuItem>
        <StyledContextMenuItem onSelect={() => { void handleCopySessionId() }}>
          <Copy className="h-3.5 w-3.5" />
          复制对话 ID
        </StyledContextMenuItem>
        {meta.isPinned && sessionActions.onUnpin ? (
          <StyledContextMenuItem onSelect={() => { void sessionActions.onUnpin?.(meta.id, meta.workspaceId) }}>
            <PinOff className="h-3.5 w-3.5" />
            取消固定
          </StyledContextMenuItem>
        ) : sessionActions.onPin ? (
          <StyledContextMenuItem onSelect={() => { void sessionActions.onPin?.(meta.id, meta.workspaceId) }}>
            <Pin className="h-3.5 w-3.5" />
            固定会话
          </StyledContextMenuItem>
        ) : null}
        <StyledContextMenuItem onSelect={() => sessionActions.onArchive(meta.id, meta.workspaceId)}>
          <Archive className="h-3.5 w-3.5" />
          归档
        </StyledContextMenuItem>
        <StyledContextMenuSeparator />
        <StyledContextMenuItem
          variant="destructive"
          onSelect={() => sessionActions.onDelete(meta.id, meta.workspaceId)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          删除
        </StyledContextMenuItem>
      </StyledContextMenuContent>
    </ContextMenu>
  ) : row

  return rowWithActions
}

export function ActivityRailSessionList({
  sessions,
  activeSessionId,
  disabled,
  onSelectSession,
  sessionActions,
  onRenameSession,
  dragHandlers,
  nested = false,
  regularLimit = PROJECT_SESSION_LIMIT,
  showAll: controlledShowAll,
  onShowAllChange,
  emptyLabel = '暂无对话',
}: {
  sessions: SessionMeta[]
  activeSessionId: string | null
  disabled: boolean
  onSelectSession?: (meta: SessionMeta) => void
  sessionActions?: ActivityRailSessionActions
  onRenameSession: (meta: SessionMeta) => void
  dragHandlers?: ActivityRailSessionDragHandlers
  nested?: boolean
  regularLimit?: number
  showAll?: boolean
  onShowAllChange?: (showAll: boolean) => void
  emptyLabel?: string
}) {
  const [internalShowAll, setInternalShowAll] = React.useState(false)
  const showAll = controlledShowAll ?? internalShowAll
  const setShowAll = onShowAllChange ?? setInternalShowAll
  const { fixed, regular } = partitionSessionMetas(sessions)
  const visibleRegular = showAll ? regular : regular.slice(0, regularLimit)
  const hasMoreRegular = regular.length > regularLimit
  // Keep source geometry stable: inserting group headings during dragstart cancels native drags.
  const showFixedGroup = fixed.length > 0
  const showRegularGroup = regular.length > 0
  const groupLabelClass = nested
    ? 'py-1 pl-[30px] pr-2'
    : 'px-2 py-1'

  const renderSession = (meta: SessionMeta) => (
    <RecentConversationRow
      key={meta.id}
      meta={meta}
      active={activeSessionId === meta.id}
      disabled={disabled}
      onSelect={() => onSelectSession?.(meta)}
      sessionActions={sessionActions}
      onRename={() => onRenameSession(meta)}
      dragHandlers={dragHandlers}
      nested={nested}
    />
  )

  if (sessions.length === 0) {
    return (
      <div className={cn(
        'py-1.5 text-[11px] text-muted-foreground/60',
        nested ? 'pl-[30px] pr-2' : 'px-3 py-3 text-xs',
      )}>
        {emptyLabel}
      </div>
    )
  }

  return (
    <>
      {showFixedGroup ? (
        <div
          data-session-group="fixed"
          onDragOver={dragHandlers ? event => event.preventDefault() : undefined}
          onDrop={dragHandlers ? event => dragHandlers.onDropOnGroup(event, true) : undefined}
        >
          <div className={cn('flex items-center gap-1 text-[10px] font-medium text-muted-foreground/65', groupLabelClass)}>
            <Pin className="size-3" />
            <span>固定会话</span>
          </div>
          {fixed.map(renderSession)}
        </div>
      ) : null}
      {showRegularGroup ? (
        <div
          data-session-group="regular"
          onDragOver={dragHandlers ? event => event.preventDefault() : undefined}
          onDrop={dragHandlers ? event => dragHandlers.onDropOnGroup(event, false) : undefined}
        >
          {showFixedGroup ? (
            <div className={cn('text-[10px] font-medium text-muted-foreground/65', groupLabelClass)}>普通会话</div>
          ) : null}
          {visibleRegular.map(renderSession)}
        </div>
      ) : null}
      {hasMoreRegular ? (
        <button
          type="button"
          aria-expanded={showAll}
          className={cn(
            'w-full rounded-[6px] py-1.5 pr-2 text-left text-[11px] text-muted-foreground/65 outline-none transition-colors hover:bg-foreground/[0.045] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring',
            nested ? 'pl-[30px]' : 'pl-2',
          )}
          onClick={() => setShowAll(!showAll)}
        >
          {showAll
            ? (nested ? '收起显示' : '收起对话')
            : (nested ? `展开显示 ${regular.length} 个普通会话` : `显示全部 ${regular.length} 个普通会话`)}
        </button>
      ) : null}
    </>
  )
}

/** Hover text: an unavailable Project explains why, so a moved folder is not mistaken for app breakage. */
function getProjectRowTitle(workspace: Workspace, canRelink: boolean): string {
  if (workspace.rootAvailable !== false) return workspace.name
  const reason = workspace.rootUnavailableReason === 'mismatch'
    ? '原位置的文件夹已不是这个项目'
    : workspace.rootUnavailableReason === 'unreadable'
      ? '无法读取项目文件夹（权限或磁盘错误）'
      : '项目文件夹已被移动、重命名或删除'
  return `${workspace.name}\n${reason}\n原位置：${workspace.rootPath}${canRelink ? '\n右键或在“…”菜单中重新关联' : ''}`
}

export function ProjectFolderRow({
  workspace,
  active,
  archived = false,
  hasUnread,
  hasActiveSession = false,
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
  sessionDragHandlers,
  onRenameSession,
  onOpenFolder,
  onOpenInNewWindow,
  onRelink,
  onRename,
  onArchive,
  onRestore,
  onRemove,
}: {
  workspace: Workspace
  active: boolean
  archived?: boolean
  hasUnread: boolean
  hasActiveSession?: boolean
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
  sessionDragHandlers?: ActivityRailSessionDragHandlers
  onRenameSession?: (meta: SessionMeta) => void
  onOpenFolder?: () => void
  onOpenInNewWindow?: () => void
  onRelink?: () => void
  onRename?: () => void
  onArchive?: () => void
  onRestore?: () => void
  onRemove?: () => void
}) {
  const { t } = useTranslation()
  // One action list feeds both the "…" dropdown and the right-click menu so they cannot drift.
  const actions = [
    onOpenFolder && { key: 'open-folder', icon: Folder, label: t('sessionMenu.showInFileManager', { fileManager: getFileManagerName() }), onSelect: onOpenFolder },
    onRelink && { key: 'relink', icon: FolderOpen, label: t('workspace.reconnect', { name: workspace.name }), onSelect: onRelink },
    onOpenInNewWindow && { key: 'new-window', icon: ArrowUpRight, label: '新窗口打开', onSelect: onOpenInNewWindow },
    onRename && { key: 'rename', icon: Pencil, label: '重命名', onSelect: onRename },
    onArchive && { key: 'archive', icon: Archive, label: '归档', onSelect: onArchive },
    onRestore && { key: 'restore', icon: ArchiveRestore, label: '恢复', onSelect: onRestore },
  ].filter(action => !!action)
  const hasMenu = actions.length > 0 || !!onRemove

  const rowContent = (
      <div className={cn(
        'group flex min-w-0 items-center rounded-[6px] hover:bg-foreground/[0.045]',
        active && 'bg-foreground/[0.07] text-foreground',
      )}>
        <button
          type="button"
          aria-label={`项目：${workspace.name}`}
          title={getProjectRowTitle(workspace, !!onRelink)}
          aria-current={active ? 'page' : undefined}
          aria-expanded={expandable ? expanded : undefined}
          // aria-disabled instead of disabled: Chromium drops hover/contextmenu events on disabled
          // buttons, which would hide the unavailable-reason tooltip and the right-click menu.
          aria-disabled={disabled || undefined}
          className={cn(
            'flex h-[30px] min-w-0 flex-1 items-center gap-1.5 rounded-[6px] px-2 text-left outline-none',
            'focus-visible:ring-1 focus-visible:ring-ring aria-disabled:cursor-default',
            archived && 'opacity-60',
          )}
          onClick={() => { if (!disabled) onToggleExpanded?.() }}
        >
          {expanded
            ? <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
            : <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/85">{workspace.name}</span>
          {workspace.rootAvailable === false ? (
            <ShieldAlert
              className="h-3.5 w-3.5 shrink-0 text-info"
              aria-label={t('workspace.reconnect', { name: workspace.name })}
            />
          ) : loadingSessions || hasActiveSession ? (
            <Loader2
              className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground/75"
              aria-label={loadingSessions ? '正在加载对话' : '项目中有对话正在运行'}
            />
          ) : hasUnread ? (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label="有未读对话" />
          ) : null}
        </button>
        {hasMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`管理 ${workspace.name}`}
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-foreground/[0.06] hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100 data-[state=open]:opacity-100',
                  !onCreateConversation && 'mr-1',
                )}
              >
                <MoreHorizontal className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <StyledDropdownMenuContent align="end" sideOffset={4}>
              {actions.map(({ key, icon: Icon, label, onSelect }) => (
                <StyledDropdownMenuItem key={key} onClick={onSelect}>
                  <Icon className="size-3.5" />
                  <span>{label}</span>
                </StyledDropdownMenuItem>
              ))}
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
        {onCreateConversation ? (
          <button
            type="button"
            aria-label={`在 ${workspace.name} 中新建任务`}
            title="新建任务"
            className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-foreground/[0.06] hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
            onClick={onCreateConversation}
          >
            <SquarePen className="size-3.5" />
          </button>
        ) : null}
      </div>
  )

  return (
    <div>
      {hasMenu ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
          <StyledContextMenuContent>
            {actions.map(({ key, icon: Icon, label, onSelect }) => (
              <StyledContextMenuItem key={key} onSelect={onSelect}>
                <Icon className="h-3.5 w-3.5" />
                {label}
              </StyledContextMenuItem>
            ))}
            {onRemove ? <StyledContextMenuSeparator /> : null}
            {onRemove ? (
              <StyledContextMenuItem variant="destructive" onSelect={onRemove}>
                <Trash2 className="h-3.5 w-3.5" />
                移除
              </StyledContextMenuItem>
            ) : null}
          </StyledContextMenuContent>
        </ContextMenu>
      ) : rowContent}
      {expandable && expanded ? (
        <div className="mt-0.5 space-y-0.5" data-testid="activity-project-conversations">
          {loadingSessions && !sessions ? (
            <div className="sr-only" role="status">正在加载对话…</div>
          ) : (
            <ActivityRailSessionList
              sessions={sessions ?? []}
              activeSessionId={activeSessionId}
              disabled={!onSelectSession}
              onSelectSession={meta => onSelectSession?.(meta.id)}
              sessionActions={sessionActions}
              onRenameSession={meta => onRenameSession?.(meta)}
              dragHandlers={sessionDragHandlers}
              nested
            />
          )}
        </div>
      ) : null}
    </div>
  )
}
