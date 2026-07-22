// input: Workspace list, active id, and open/manage callbacks
// output: Column list popover for quick project switching from the activity rail
// pos: In-room project switcher; full ProjectHub remains the manage surface

import * as React from 'react'
import { Check, Cloud, LayoutGrid, Plus, Search } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { Workspace } from '../../../shared/types'
import { formatTopbarWorkspaceName } from './workspace-switcher-label'

export interface ProjectSwitcherPopoverProps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelectProject: (workspaceId: string) => void
  /** Open full library / manage surface (create, import, remote). */
  onManageProjects?: () => void
  /** Optional: jump straight into create flow from the list footer. */
  onCreateProject?: () => void
  children: React.ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
}

function sortByRecent(workspaces: Workspace[]): Workspace[] {
  return [...workspaces].sort((left, right) => {
    const leftAt = typeof left.lastAccessedAt === 'number' ? left.lastAccessedAt : 0
    const rightAt = typeof right.lastAccessedAt === 'number' ? right.lastAccessedAt : 0
    if (rightAt !== leftAt) return rightAt - leftAt
    return left.name.localeCompare(right.name, 'zh-Hans')
  })
}

function formatActivity(workspace: Workspace): string {
  const at = typeof workspace.lastAccessedAt === 'number' ? workspace.lastAccessedAt : undefined
  if (!at) return '暂无最近打开'
  try {
    return new Date(at).toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '暂无最近打开'
  }
}

export function ProjectSwitcherPopover({
  workspaces,
  activeWorkspaceId,
  onSelectProject,
  onManageProjects,
  onCreateProject,
  children,
  open: openProp,
  onOpenChange,
  side = 'right',
  align = 'start',
}: ProjectSwitcherPopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const open = openProp ?? uncontrolledOpen
  const setOpen = onOpenChange ?? setUncontrolledOpen
  const [query, setQuery] = React.useState('')

  React.useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const sorted = React.useMemo(() => sortByRecent(workspaces), [workspaces])
  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return sorted
    return sorted.filter((workspace) => {
      const name = workspace.name.toLowerCase()
      const path = (workspace.rootPath ?? '').toLowerCase()
      return name.includes(needle) || path.includes(needle)
    })
  }, [query, sorted])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={8}
        className="w-[300px] overflow-hidden rounded-[10px] border border-border/60 bg-background p-0 shadow-modal-small"
        data-testid="project-switcher-popover"
      >
        <div className="border-b border-border/50 px-3 py-2.5">
          <div className="text-[13px] font-medium text-foreground">切换项目</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">从最近打开的项目中选择</div>
          {workspaces.length > 5 ? (
            <label className="relative mt-2 block">
              <span className="sr-only">搜索项目</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索名称或路径"
                className="h-8 rounded-md bg-foreground-2 pl-8 text-xs"
                autoFocus
              />
            </label>
          ) : null}
        </div>

        <div className="max-h-[min(360px,50vh)] overflow-y-auto py-1" role="listbox" aria-label="历史项目">
          {visible.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              {workspaces.length === 0 ? '还没有项目' : '没有匹配的项目'}
            </div>
          ) : (
            visible.map((workspace) => {
              const isActive = workspace.id === activeWorkspaceId
              return (
                <button
                  key={workspace.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  data-testid={`project-switcher-item-${workspace.id}`}
                  onClick={() => {
                    setOpen(false)
                    if (!isActive) onSelectProject(workspace.id)
                  }}
                  className={cn(
                    'flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors',
                    'hover:bg-foreground/[0.04] focus-visible:bg-foreground/[0.04] focus-visible:outline-none',
                    isActive && 'bg-foreground/[0.05]',
                  )}
                >
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground-2 text-[12px] font-semibold text-foreground">
                    {(workspace.name.charAt(0) || '项').toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-foreground">
                        {formatTopbarWorkspaceName(workspace.name)}
                      </span>
                      {workspace.remoteServer ? (
                        <Cloud className="size-3 shrink-0 text-muted-foreground" />
                      ) : null}
                      {isActive ? (
                        <Check className="ml-auto size-3.5 shrink-0 text-accent" />
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {workspace.rootPath || formatActivity(workspace)}
                    </span>
                    {workspace.rootPath ? (
                      <span className="mt-0.5 block truncate text-[10px] text-muted-foreground/70">
                        {formatActivity(workspace)}
                      </span>
                    ) : null}
                  </span>
                </button>
              )
            })
          )}
        </div>

        {(onManageProjects || onCreateProject) ? (
          <div className="flex flex-col gap-0.5 border-t border-border/50 p-1.5">
            {onCreateProject ? (
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onCreateProject()
                }}
                className="flex h-8 items-center gap-2 rounded-md px-2 text-[12px] text-foreground hover:bg-foreground/[0.04]"
              >
                <Plus className="size-3.5 text-muted-foreground" />
                新建项目
              </button>
            ) : null}
            {onManageProjects ? (
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onManageProjects()
                }}
                className="flex h-8 items-center gap-2 rounded-md px-2 text-[12px] text-foreground hover:bg-foreground/[0.04]"
              >
                <LayoutGrid className="size-3.5 text-muted-foreground" />
                管理全部项目
              </button>
            ) : null}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
