// input: Workspace identity, transport state, and update status
// output: Thin desktop window title bar with current project context only
// pos: Window chrome layer above ActivityRail and project work surfaces

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Cloud, CloudOff, Download, RefreshCw } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { FadingText } from '@/components/ui/fading-text'
import { cn } from '@/lib/utils'
import { useTransportConnectionState } from '@/hooks/useTransportConnectionState'
import { useUpdateChecker } from '@/hooks/useUpdateChecker'
import { getUpdateIndicatorState } from '@/lib/update-indicator'
import type { Workspace, WorkspaceProjectType } from '../../../shared/types'
import { formatTopbarWorkspaceName } from './workspace-switcher-label'

export const WINDOW_TITLE_BAR_HEIGHT = 40

interface TopBarProps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  isCompact?: boolean
}

export function TopBar({
  workspaces,
  activeWorkspaceId,
  isCompact,
}: TopBarProps) {
  const { t } = useTranslation()
  const connectionState = useTransportConnectionState()
  const updateChecker = useUpdateChecker()
  const updateIndicator = getUpdateIndicatorState(updateChecker.updateInfo)

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId),
    [activeWorkspaceId, workspaces]
  )
  const workspaceName = selectedWorkspace?.name ?? '未选择项目'
  const displayName = formatTopbarWorkspaceName(workspaceName)
  const projectTypeLabel = getWorkspaceProjectTypeLabel(selectedWorkspace)
  const isRemoteWorkspace = Boolean(selectedWorkspace?.remoteServer)
  const isDisconnected = isRemoteWorkspace
    && connectionState?.mode === 'remote'
    && connectionState.status !== 'connected'

  return (
    <header
      data-testid="window-title-bar"
      aria-label="窗口上下文"
      className="fixed left-0 right-0 top-0 z-panel titlebar-drag-region border-b border-border/25 bg-background/90 text-foreground"
      style={{ height: WINDOW_TITLE_BAR_HEIGHT }}
    >
      <div
        className={cn(
          'pointer-events-none absolute left-1/2 top-1/2 flex min-w-0 max-w-[min(520px,58vw)] -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-1.5 text-center',
          isCompact && 'max-w-[min(360px,62vw)]'
        )}
      >
        <span className="shrink-0 text-[12px] font-medium text-muted-foreground">
          {projectTypeLabel}
        </span>
        <span className="shrink-0 text-[12px] text-muted-foreground/40" aria-hidden="true">/</span>
        <FadingText className="min-w-0 max-w-[320px] whitespace-nowrap text-[13px] font-medium text-foreground" fadeWidth={24}>
          {displayName}
        </FadingText>
        {isRemoteWorkspace ? (
          isDisconnected
            ? <CloudOff className="h-3 w-3 shrink-0 text-destructive" />
            : <Cloud className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : null}
      </div>

      {updateIndicator ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={
                updateIndicator.kind === 'ready'
                  ? t('settings.about.restartToUpdate', { version: updateIndicator.version ?? '' })
                  : updateIndicator.kind === 'downloading'
                    ? t('settings.about.downloading', { version: updateIndicator.version ?? '', percent: updateIndicator.progress })
                    : t('toast.installingUpdate')
              }
              disabled={!updateIndicator.actionable}
              onClick={() => {
                if (updateIndicator.actionable) {
                  void updateChecker.installUpdate()
                }
              }}
              className={cn(
                'titlebar-no-drag absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md outline-none transition-colors',
                'focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default',
                updateIndicator.kind === 'ready'
                  ? 'bg-accent/10 text-accent hover:bg-accent/15'
                  : 'bg-foreground/5 text-foreground/60'
              )}
            >
              {updateIndicator.kind === 'ready' ? (
                <Download className="h-3.5 w-3.5" strokeWidth={1.7} />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={1.7} />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {updateIndicator.kind === 'ready'
              ? t('settings.about.restartToUpdate', { version: updateIndicator.version ?? '' })
              : updateIndicator.kind === 'downloading'
                ? t('settings.about.downloading', { version: updateIndicator.version ?? '', percent: updateIndicator.progress })
                : t('toast.installingUpdate')}
          </TooltipContent>
        </Tooltip>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t('settings.about.checkForUpdates')}
              onClick={() => void updateChecker.checkForUpdates()}
              className={cn(
                'titlebar-no-drag absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md outline-none transition-colors',
                'bg-foreground/5 text-foreground/60 hover:bg-foreground/10 hover:text-foreground/80 focus-visible:ring-1 focus-visible:ring-ring'
              )}
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.7} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {t('settings.about.checkForUpdates')}
          </TooltipContent>
        </Tooltip>
      )}
    </header>
  )
}

type WorkspaceWithProjectMetadata = Workspace & {
  projectType?: WorkspaceProjectType
  methodPackId?: string
}

function getWorkspaceProjectTypeLabel(workspace: Workspace | undefined): string {
  const metadata = workspace as WorkspaceWithProjectMetadata | undefined
  switch (metadata?.projectType) {
    case 'novel':
      return '小说'
    case 'short-form':
      return '短篇'
    case 'screenplay':
      return '剧本'
    case 'general':
      return '项目'
    default:
      if (metadata?.methodPackId?.startsWith('short-form.')) return '短篇'
      if (metadata?.methodPackId?.startsWith('novel.')) return '小说'
      if (metadata?.methodPackId?.startsWith('screenplay.')) return '剧本'
      return '项目'
  }
}
