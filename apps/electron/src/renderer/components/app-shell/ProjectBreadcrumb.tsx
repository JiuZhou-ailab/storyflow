// input: Workspace list, active workspace id, and ProjectHub navigation callback
// output: Top-bar project breadcrumb with a direct ProjectHub return action
// pos: Primary project context surface inside AppShell, separate from workspace switching menus

import { ChevronRight, Cloud, CloudOff, LayoutGrid } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { CrossfadeAvatar } from '@/components/ui/avatar'
import { FadingText } from '@/components/ui/fading-text'
import { cn } from '@/lib/utils'
import { useTransportConnectionState } from '@/hooks/useTransportConnectionState'
import { useWorkspaceIcons } from '@/hooks/useWorkspaceIcon'
import type { Workspace } from '../../../shared/types'
import { formatTopbarWorkspaceName } from './workspace-switcher-label'

interface ProjectBreadcrumbProps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onOpenProjectHub?: () => void
  isCompact?: boolean
}

export function ProjectBreadcrumb({
  workspaces,
  activeWorkspaceId,
  onOpenProjectHub,
  isCompact,
}: ProjectBreadcrumbProps) {
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId)
  const workspaceIconMap = useWorkspaceIcons(workspaces)
  const connectionState = useTransportConnectionState()
  const workspaceName = selectedWorkspace?.name ?? '未选择项目'
  const displayName = formatTopbarWorkspaceName(workspaceName)
  const isRemoteWorkspace = Boolean(selectedWorkspace?.remoteServer)
  const isDisconnected = isRemoteWorkspace
    && connectionState?.mode === 'remote'
    && connectionState.status !== 'connected'

  return (
    <nav
      data-testid="project-breadcrumb"
      aria-label="项目位置"
      className="titlebar-no-drag flex min-w-0 items-center gap-1 rounded-lg px-1"
    >
      {onOpenProjectHub ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="退出到作品库"
              onClick={onOpenProjectHub}
              className={cn(
                'inline-flex h-[28px] shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium',
                'text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span className={cn('whitespace-nowrap', isCompact && 'sr-only')}>作品库</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">退出到作品库</TooltipContent>
        </Tooltip>
      ) : (
        <div className="inline-flex h-[28px] shrink-0 items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground">
          <LayoutGrid className="h-3.5 w-3.5" />
          <span className={cn('whitespace-nowrap', isCompact && 'sr-only')}>作品库</span>
        </div>
      )}

      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />

      <Tooltip>
        <TooltipTrigger asChild>
          <div
            data-testid="project-breadcrumb-current"
            aria-label={`当前项目：${workspaceName}`}
            className="flex h-[28px] min-w-0 items-center gap-1.5 rounded-md px-2 text-xs text-foreground"
          >
            {selectedWorkspace ? (
              <CrossfadeAvatar
                src={workspaceIconMap.get(selectedWorkspace.id) ?? undefined}
                fallback={workspaceName.charAt(0) || '项'}
                className="h-4 w-4 shrink-0 rounded-[5px]"
              />
            ) : null}
            <FadingText className="min-w-0 max-w-[220px] whitespace-nowrap text-sm font-medium" fadeWidth={28}>
              {displayName}
            </FadingText>
            {isRemoteWorkspace ? (
              isDisconnected
                ? <CloudOff className="h-3 w-3 shrink-0 text-destructive" />
                : <Cloud className="h-3 w-3 shrink-0 text-muted-foreground" />
            ) : null}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">{workspaceName}</TooltipContent>
      </Tooltip>
    </nav>
  )
}
