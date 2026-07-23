// input: Workspace list, create/import/remote handlers, optional onWorkspaceCreated
// output: Project manager UI with list + inline create/import/remote subviews
// pos: Single project surface for rail dialog and cold-start; no full-page create flow

import * as React from 'react'
import {
  ArrowLeft,
  ArrowUpRight,
  Cloud,
  FolderOpen,
  Import,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { RenameDialog } from '@/components/ui/rename-dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { cn } from '@/lib/utils'
import { AddWorkspaceStep_CreateNew } from '@/components/workspace/AddWorkspaceStep_CreateNew'
import { AddWorkspaceStep_OpenFolder } from '@/components/workspace/AddWorkspaceStep_OpenFolder'
import { AddWorkspaceStep_ConnectRemote } from '@/components/workspace/AddWorkspaceStep_ConnectRemote'
import type { RemoteServerConfig, Workspace, WorkspaceProjectType } from '../../../shared/types'
import type { MethodPackId } from '@craft-agent/shared/writing/method-packs'
import { formatTopbarWorkspaceName } from './workspace-switcher-label'

export type ProjectManagerView = 'list' | 'create' | 'open' | 'remote'

export interface ProjectManagerPanelProps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelectProject: (workspaceId: string) => void
  /** Fallback when onWorkspaceCreated is not provided (legacy). */
  onCreateProject?: () => void
  onImportProject?: () => void
  onConnectRemoteProject?: () => void
  /** Preferred: create/import/remote stay inside this panel. */
  onWorkspaceCreated?: (workspace: Workspace) => void | Promise<void>
  onOpenProjectInNewWindow?: (workspaceId: string) => void
  onRenameProject?: (workspaceId: string, name: string) => void | Promise<void>
  onRemoveProject?: (workspaceId: string) => void | Promise<void>
  /** dialog: centered modal; standalone: cold-start panel */
  variant?: 'dialog' | 'standalone' | 'popover'
  className?: string
  onRequestClose?: () => void
  /** Controlled subview; when omitted, panel owns list/create/open/remote state. */
  view?: ProjectManagerView
  onViewChange?: (view: ProjectManagerView) => void
}

function sortByRecent(workspaces: Workspace[]): Workspace[] {
  return [...workspaces].sort((left, right) => {
    const leftAt = typeof left.lastAccessedAt === 'number' ? left.lastAccessedAt : 0
    const rightAt = typeof right.lastAccessedAt === 'number' ? right.lastAccessedAt : 0
    if (rightAt !== leftAt) return rightAt - leftAt
    return left.name.localeCompare(right.name, 'zh-Hans')
  })
}

function formatRelativeActivity(workspace: Workspace): string {
  const at = typeof workspace.lastAccessedAt === 'number' ? workspace.lastAccessedAt : undefined
  if (!at) return '未打开过'
  const delta = Date.now() - at
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (delta < minute) return '刚刚'
  if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`
  if (delta < day) return `${Math.floor(delta / hour)} 小时前`
  if (delta < 7 * day) return `${Math.floor(delta / day)} 天前`
  try {
    return new Date(at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  } catch {
    return '更早'
  }
}

function shortLocation(workspace: Workspace): string {
  if (workspace.remoteServer) {
    try {
      return new URL(workspace.remoteServer.url).host
    } catch {
      return '远端'
    }
  }
  const path = workspace.rootPath?.replace(/\\/g, '/') ?? ''
  if (!path) return '本地'
  const parts = path.split('/').filter(Boolean)
  if (parts.length <= 2) return path
  return `…/${parts.slice(-2).join('/')}`
}

const EMBEDDED_STEP_CLASS =
  'h-full min-h-0 max-h-none max-w-none w-full items-stretch'

const PROJECT_STEP_COPY: Record<Exclude<ProjectManagerView, 'list'>, { title: string; description: string }> = {
  create: {
    title: '创建项目',
    description: '选择写作方法和保存位置。',
  },
  open: {
    title: '导入文件夹',
    description: '将已有写作目录加入项目列表。',
  },
  remote: {
    title: '连接远端',
    description: '连接已有的 Storyflow Server。',
  },
}

export function ProjectManagerPanel({
  workspaces,
  activeWorkspaceId,
  onSelectProject,
  onCreateProject,
  onImportProject,
  onConnectRemoteProject,
  onWorkspaceCreated,
  onOpenProjectInNewWindow,
  onRenameProject,
  onRemoveProject,
  variant = 'dialog',
  className,
  onRequestClose,
  view: viewProp,
  onViewChange,
}: ProjectManagerPanelProps) {
  const [query, setQuery] = React.useState('')
  const [renameTarget, setRenameTarget] = React.useState<Workspace | null>(null)
  const [renameValue, setRenameValue] = React.useState('')
  const [menuOpenId, setMenuOpenId] = React.useState<string | null>(null)
  const [uncontrolledView, setUncontrolledView] = React.useState<ProjectManagerView>('list')
  const [isCreating, setIsCreating] = React.useState(false)

  const view = viewProp ?? uncontrolledView
  const setView = onViewChange ?? setUncontrolledView
  const inlineCreate = typeof onWorkspaceCreated === 'function'

  const sorted = React.useMemo(() => sortByRecent(workspaces), [workspaces])
  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return sorted
    return sorted.filter((workspace) => {
      const name = workspace.name.toLowerCase()
      const path = (workspace.rootPath ?? '').toLowerCase()
      const remote = (workspace.remoteServer?.url ?? '').toLowerCase()
      return name.includes(needle) || path.includes(needle) || remote.includes(needle)
    })
  }, [query, sorted])

  const runAndClose = React.useCallback((action: () => void) => {
    onRequestClose?.()
    action()
  }, [onRequestClose])

  const openCreate = React.useCallback(() => {
    if (inlineCreate) {
      setView('create')
      return
    }
    if (onCreateProject) runAndClose(onCreateProject)
  }, [inlineCreate, onCreateProject, runAndClose, setView])

  const openImport = React.useCallback(() => {
    if (inlineCreate) {
      setView('open')
      return
    }
    if (onImportProject) runAndClose(onImportProject)
  }, [inlineCreate, onImportProject, runAndClose, setView])

  const openRemote = React.useCallback(() => {
    if (inlineCreate) {
      setView('remote')
      return
    }
    if (onConnectRemoteProject) runAndClose(onConnectRemoteProject)
  }, [inlineCreate, onConnectRemoteProject, runAndClose, setView])

  const handleCreateWorkspace = React.useCallback(async (
    folderPath: string,
    name: string,
    remoteServer?: RemoteServerConfig,
    projectType: WorkspaceProjectType = 'general',
    methodPackId?: MethodPackId,
  ) => {
    if (!onWorkspaceCreated) return
    setIsCreating(true)
    try {
      const workspace = await window.electronAPI.createWorkspace(folderPath, name, {
        ...(remoteServer && { remoteServer }),
        projectType,
        ...(methodPackId && { methodPackId }),
      })
      await onWorkspaceCreated(workspace)
      setView('list')
      onRequestClose?.()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast.error('创建项目失败', { description: message })
    } finally {
      setIsCreating(false)
    }
  }, [onRequestClose, onWorkspaceCreated, setView])

  const isDialog = variant === 'dialog' || variant === 'popover'
  const showSearch = workspaces.length > 3 || query.length > 0
  const isWideStep = view === 'create'
  const showCreateAction = inlineCreate || Boolean(onCreateProject)
  const showImportAction = inlineCreate || Boolean(onImportProject)
  const showRemoteAction = inlineCreate || Boolean(onConnectRemoteProject)
  const stepCopy = view === 'list' ? null : PROJECT_STEP_COPY[view]

  return (
    <div
      data-testid="project-manager-panel"
      data-variant={isDialog ? 'dialog' : variant}
      data-view={view}
      className={cn(
        'flex min-h-0 flex-col overflow-hidden bg-background text-foreground',
        isDialog
          ? cn(
            'w-full rounded-2xl',
            'shadow-[0_0_0_1px_rgba(0,0,0,0.05),0_28px_80px_-20px_rgba(0,0,0,0.32)]',
            'dark:shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_32px_88px_-22px_rgba(0,0,0,0.7)]',
            isWideStep ? 'h-[min(720px,calc(100vh-4rem))]' : 'min-h-[min(500px,72vh)]',
          )
          : 'w-full max-w-[720px] rounded-2xl shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_16px_48px_-12px_rgba(0,0,0,0.2)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_20px_56px_-14px_rgba(0,0,0,0.55)]',
        className,
      )}
    >
      {view !== 'list' && inlineCreate ? (
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <header className="border-b border-foreground/[0.06] px-5 py-3.5 sm:px-7">
            <div className="mx-auto flex w-full max-w-[968px] items-center gap-3">
              <button
                type="button"
                onClick={() => setView('list')}
                disabled={isCreating}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowLeft className="size-3.5" strokeWidth={1.8} />
                返回项目
              </button>
              <span className="h-4 w-px bg-foreground/[0.10]" aria-hidden />
              <div className="min-w-0">
                <h2 className="text-[14px] font-semibold tracking-[-0.015em] text-foreground">
                  {stepCopy?.title}
                </h2>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {stepCopy?.description}
                </p>
              </div>
            </div>
          </header>
          <div
            className={cn(
              'mx-auto flex min-h-0 w-full flex-1 flex-col overflow-hidden px-5 py-5 sm:px-7 sm:py-6',
              view === 'create' ? 'max-w-[968px]' : 'max-w-[600px]',
            )}
          >
            {view === 'create' ? (
              <AddWorkspaceStep_CreateNew
                onBack={() => setView('list')}
                onCreate={handleCreateWorkspace}
                isCreating={isCreating}
                className={EMBEDDED_STEP_CLASS}
                embedded
              />
            ) : null}
            {view === 'open' ? (
              <AddWorkspaceStep_OpenFolder
                onBack={() => setView('list')}
                onCreate={handleCreateWorkspace}
                isCreating={isCreating}
                className={EMBEDDED_STEP_CLASS}
                embedded
              />
            ) : null}
            {view === 'remote' ? (
              <AddWorkspaceStep_ConnectRemote
                onBack={() => setView('list')}
                onCreate={handleCreateWorkspace}
                isCreating={isCreating}
                className={EMBEDDED_STEP_CLASS}
                embedded
              />
            ) : null}
          </div>
        </section>
      ) : (
        <>
          <header className="shrink-0 border-b border-foreground/[0.06] px-5 py-4 sm:px-7">
            <div className="flex min-w-0 items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <FolderOpen className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.7} />
                <h2 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-foreground">项目</h2>
                {workspaces.length > 0 ? (
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {workspaces.length}
                  </span>
                ) : null}
              </div>
            {(showCreateAction || showImportAction || showRemoteAction) ? (
              <div className="flex shrink-0 items-center gap-1" aria-label="项目操作">
                {showCreateAction ? (
                  <ProjectActionButton
                    icon={<Plus className="size-4" strokeWidth={2} />}
                    title="新建项目"
                    onClick={openCreate}
                    primary
                  />
                ) : null}
                {showImportAction ? (
                  <ProjectActionButton
                    icon={<Import className="size-3.5" strokeWidth={1.8} />}
                    title="导入"
                    onClick={openImport}
                  />
                ) : null}
                {showRemoteAction ? (
                  <ProjectActionButton
                    icon={<Cloud className="size-3.5" strokeWidth={1.8} />}
                    title="远端"
                    onClick={openRemote}
                  />
                ) : null}
              </div>
            ) : null}
            </div>
          </header>

          <div
            className={cn(
              'min-h-0 flex-1 overflow-y-auto',
              'max-h-[min(500px,56vh)] px-3 py-3 sm:px-4 sm:py-4',
            )}
            role="listbox"
            aria-label="最近项目"
          >
            {visible.length > 0 ? (
              <div className="mb-2 flex items-center justify-between gap-4 px-2 py-1">
                <p className="text-[11px] font-medium text-muted-foreground">最近项目</p>
                {showSearch ? (
                  <label className="relative block w-[176px] shrink-0">
                    <span className="sr-only">搜索项目</span>
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="搜索项目…"
                      className="h-9 rounded-lg border-0 bg-foreground/[0.045] pl-8 text-[12px] text-foreground shadow-none placeholder:text-muted-foreground/55 focus-visible:ring-1 focus-visible:ring-foreground/15"
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
            {visible.length === 0 ? (
              <EmptyState
                isEmptyLibrary={workspaces.length === 0}
                hasQuery={Boolean(query.trim())}
                onClearQuery={() => setQuery('')}
              />
            ) : (
              <ul className="flex flex-col gap-0.5 pb-1">
                {visible.map((workspace) => {
                  const isActive = workspace.id === activeWorkspaceId
                  const menuOpen = menuOpenId === workspace.id
                  return (
                    <li key={workspace.id}>
                      <div
                        className={cn(
                          'group relative flex items-center transition-colors',
                          'rounded-lg',
                          isActive
                            ? 'bg-foreground/[0.06]'
                            : 'hover:bg-foreground/[0.035]',
                          menuOpen && !isActive && 'bg-foreground/[0.035]',
                        )}
                      >
                        {isActive ? (
                          <span
                            className={cn(
                              'absolute left-1.5 top-1/2 w-[2px] -translate-y-1/2 rounded-full bg-foreground/70',
                              'h-4',
                            )}
                            aria-hidden
                          />
                        ) : null}
                        <button
                          type="button"
                          role="option"
                          aria-selected={isActive}
                          data-testid={`project-switcher-item-${workspace.id}`}
                          onClick={() => {
                            if (isActive) {
                              onRequestClose?.()
                              return
                            }
                            runAndClose(() => onSelectProject(workspace.id))
                          }}
                          className={cn(
                            'flex min-w-0 flex-1 items-center text-left outline-none',
                            'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-foreground/20',
                            'gap-2.5 py-2.5 pl-3 pr-1',
                          )}
                        >
                          <span
                            className={cn(
                              'flex shrink-0 items-center justify-center font-semibold tracking-tight',
                              'size-9 rounded-[10px] text-[13px]',
                              isActive
                                ? 'bg-foreground text-background'
                                : 'bg-foreground/[0.06] text-foreground/85',
                            )}
                          >
                            {(workspace.name.charAt(0) || '项').toUpperCase()}
                          </span>
                          <span className="min-w-0 flex-1 py-0.5">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className={cn(
                                'truncate font-medium leading-none tracking-[-0.01em] text-foreground',
                                'text-[14px]',
                              )}>
                                {formatTopbarWorkspaceName(workspace.name)}
                              </span>
                              {workspace.remoteServer ? (
                                <Cloud className="size-3 shrink-0 text-muted-foreground/70" strokeWidth={1.75} />
                              ) : null}
                              {isActive ? (
                                <span className="shrink-0 rounded-full bg-foreground/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                  当前
                                </span>
                              ) : null}
                            </span>
                            <span className={cn(
                              'mt-1 flex min-w-0 items-center gap-1.5 leading-none text-muted-foreground/75',
                              'text-[12px]',
                            )}>
                              <span className="truncate">{shortLocation(workspace)}</span>
                              <span className="shrink-0 text-muted-foreground/30" aria-hidden>·</span>
                              <span className="shrink-0 tabular-nums">{formatRelativeActivity(workspace)}</span>
                            </span>
                          </span>
                        </button>

                        {(onOpenProjectInNewWindow || onRenameProject || onRemoveProject) ? (
                          <div
                            className={cn(
                              'mr-1.5 flex shrink-0 items-center transition-opacity',
                              menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
                            )}
                          >
                            <DropdownMenu
                              open={menuOpen}
                              onOpenChange={(open) => setMenuOpenId(open ? workspace.id : null)}
                            >
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  aria-label={`管理 ${workspace.name}`}
                                  className="flex size-8 items-center justify-center rounded-lg text-muted-foreground/80 hover:bg-foreground/[0.06] hover:text-foreground"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
                                </button>
                              </DropdownMenuTrigger>
                              <StyledDropdownMenuContent align="end" sideOffset={4}>
                                {onOpenProjectInNewWindow ? (
                                  <StyledDropdownMenuItem
                                    onClick={() => {
                                      onRequestClose?.()
                                      onOpenProjectInNewWindow(workspace.id)
                                    }}
                                  >
                                    <ArrowUpRight className="size-3.5" />
                                    <span>新窗口打开</span>
                                  </StyledDropdownMenuItem>
                                ) : null}
                                {onRenameProject ? (
                                  <StyledDropdownMenuItem
                                    onClick={() => {
                                      setRenameTarget(workspace)
                                      setRenameValue(workspace.name)
                                    }}
                                  >
                                    <Pencil className="size-3.5" />
                                    <span>重命名</span>
                                  </StyledDropdownMenuItem>
                                ) : null}
                                {(onOpenProjectInNewWindow || onRenameProject) && onRemoveProject ? (
                                  <StyledDropdownMenuSeparator />
                                ) : null}
                                {onRemoveProject ? (
                                  <StyledDropdownMenuItem
                                    variant="destructive"
                                    onClick={() => {
                                      if (workspace.id === activeWorkspaceId) return
                                      const ok = window.confirm(`从列表中移除「${workspace.name}」？不会删除磁盘文件。`)
                                      if (!ok) return
                                      onRequestClose?.()
                                      void onRemoveProject(workspace.id)
                                    }}
                                    disabled={workspace.id === activeWorkspaceId}
                                  >
                                    <Trash2 className="size-3.5" />
                                    <span>移除</span>
                                  </StyledDropdownMenuItem>
                                ) : null}
                              </StyledDropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </>
      )}

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
    </div>
  )
}

function ProjectActionButton({
  icon,
  title,
  onClick,
  primary = false,
}: {
  icon: React.ReactNode
  title: string
  onClick: () => void
  primary?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors',
        primary
          ? 'bg-foreground text-background hover:bg-foreground/90'
          : 'text-muted-foreground hover:bg-foreground/[0.055] hover:text-foreground',
      )}
    >
      {icon}
      {title}
    </button>
  )
}

function EmptyState({
  isEmptyLibrary,
  hasQuery,
  onClearQuery,
}: {
  isEmptyLibrary: boolean
  hasQuery: boolean
  onClearQuery: () => void
}) {
  return (
    <div className="flex flex-col items-center px-4 py-14 text-center">
      <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-foreground/[0.04] text-muted-foreground/80">
        <FolderOpen className="size-5" strokeWidth={1.5} />
      </div>
      <p className="text-[14px] font-medium tracking-[-0.01em] text-foreground">
        {isEmptyLibrary ? '还没有项目' : '没有匹配结果'}
      </p>
      <p className="mt-1.5 max-w-[260px] text-[12px] leading-relaxed text-muted-foreground">
        {isEmptyLibrary
          ? '直接在这里新建写作项目，或导入已有文件夹。'
          : '换个关键词，或清空搜索。'}
      </p>
      {!isEmptyLibrary && hasQuery ? (
        <button
          type="button"
          className="mt-3 text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={onClearQuery}
        >
          清空搜索
        </button>
      ) : null}
    </div>
  )
}
