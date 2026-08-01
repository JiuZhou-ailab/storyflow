// input: Session/workspace metadata, project disclosure state, runtime indicators, and row callbacks
// output: Compact free-conversation and project-tree rows with low-noise visual and accessible runtime status
// pos: Visual row primitives for ActivityRail; owns row-level hover, loading, status, and context actions

import * as React from 'react'
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
  Plus,
  Trash2,
} from 'lucide-react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
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

const PROJECT_SESSION_LIMIT = 5

export interface ActivityRailSessionActions {
  onRename: (sessionId: string, name: string) => void
  onArchive: (sessionId: string) => void
  onDelete: (sessionId: string) => void
}

export function RecentConversationRow({
  meta,
  active,
  disabled,
  onSelect,
  sessionActions,
  onRename,
  nested = false,
}: {
  meta: SessionMeta
  active: boolean
  disabled: boolean
  onSelect: () => void
  sessionActions?: ActivityRailSessionActions
  onRename: () => void
  nested?: boolean
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
      className={cn(
        'flex w-full min-w-0 items-center rounded-[6px] hover:bg-foreground/[0.045]',
        active && 'bg-foreground/[0.07] text-foreground',
      )}
    >
      <button
        type="button"
        aria-label={getSessionTitle(meta)}
        aria-current={active ? 'page' : undefined}
        disabled={disabled}
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
          <span className="shrink-0 text-[11px] text-muted-foreground/70">{formatRelativeTimestamp(meta.lastMessageAt, '')}</span>
        ) : null}
      </button>
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
        <StyledContextMenuItem onSelect={() => sessionActions.onArchive(meta.id)}>
          <Archive className="h-3.5 w-3.5" />
          归档
        </StyledContextMenuItem>
        <StyledContextMenuSeparator />
        <StyledContextMenuItem
          variant="destructive"
          onSelect={() => sessionActions.onDelete(meta.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          删除
        </StyledContextMenuItem>
      </StyledContextMenuContent>
    </ContextMenu>
  ) : row

  return rowWithActions
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
  onRenameSession?: (meta: SessionMeta) => void
  onOpenInNewWindow?: () => void
  onRename?: () => void
  onArchive?: () => void
  onRestore?: () => void
  onRemove?: () => void
}) {
  const [showAllSessions, setShowAllSessions] = React.useState(false)
  const visibleSessions = showAllSessions ? sessions : sessions?.slice(0, PROJECT_SESSION_LIMIT)
  const hasMoreSessions = (sessions?.length ?? 0) > PROJECT_SESSION_LIMIT

  return (
    <div>
      <div className={cn(
        'group flex min-w-0 items-center rounded-[6px] hover:bg-foreground/[0.045]',
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
          {expanded
            ? <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
            : <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/85">{workspace.name}</span>
          {loadingSessions || hasActiveSession ? (
            <Loader2
              className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground/75"
              aria-label={loadingSessions ? '正在加载对话' : '项目中有对话正在运行'}
            />
          ) : hasUnread ? (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label="有未读对话" />
          ) : null}
        </button>
        {onCreateConversation ? (
          <button
            type="button"
            aria-label={`在 ${workspace.name} 中新建任务`}
            title="新建任务"
            className="flex size-7 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-foreground/[0.06] hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
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
        <div className="mt-0.5 space-y-0.5" data-testid="activity-project-conversations">
          {loadingSessions && !sessions ? (
            <div className="sr-only" role="status">正在加载对话…</div>
          ) : visibleSessions && visibleSessions.length > 0 ? (
            <>
              {visibleSessions.map((meta) => (
                <RecentConversationRow
                  key={meta.id}
                  meta={meta}
                  active={activeSessionId === meta.id}
                  disabled={!onSelectSession}
                  onSelect={() => onSelectSession?.(meta.id)}
                  sessionActions={sessionActions}
                  onRename={() => onRenameSession?.(meta)}
                  nested
                />
              ))}
              {hasMoreSessions ? (
                <button
                  type="button"
                  aria-expanded={showAllSessions}
                  className="w-full rounded-[6px] py-1.5 pl-[30px] pr-2 text-left text-[11px] text-muted-foreground/65 outline-none transition-colors hover:bg-foreground/[0.045] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={() => setShowAllSessions(value => !value)}
                >
                  {showAllSessions ? '收起显示' : '展开显示'}
                </button>
              ) : null}
            </>
          ) : (
            <div className="py-1.5 pl-[30px] pr-2 text-[11px] text-muted-foreground/60">暂无对话</div>
          )}
        </div>
      ) : null}
    </div>
  )
}
