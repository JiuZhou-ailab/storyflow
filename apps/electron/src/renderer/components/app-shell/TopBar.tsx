// input: Workspace identity, transport state, and right-panel visibility
// output: Thin desktop window title bar with current project context and panel toggle
// pos: Window chrome layer above ActivityRail and project work surfaces

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Cloud, CloudOff, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { FadingText } from '@/components/ui/fading-text'
import { cn } from '@/lib/utils'
import { useTransportConnectionState } from '@/hooks/useTransportConnectionState'
import type { Workspace } from '../../../shared/types'
import { formatTopbarWorkspaceName } from './workspace-switcher-label'
import { WINDOW_TITLE_BAR_HEIGHT } from './layout-constants'

interface TopBarProps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  isCompact?: boolean
  isRightPanelVisible?: boolean
  onToggleRightPanel?: () => void
}

export function TopBar({
  workspaces,
  activeWorkspaceId,
  isCompact,
  isRightPanelVisible,
  onToggleRightPanel,
}: TopBarProps) {
  const { t } = useTranslation()
  const connectionState = useTransportConnectionState()

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId),
    [activeWorkspaceId, workspaces]
  )
  const workspaceName = selectedWorkspace?.name ?? '未选择项目'
  const displayName = formatTopbarWorkspaceName(workspaceName)
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
          {t('workspace.projectLabel', '项目')}
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

      {onToggleRightPanel ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={isRightPanelVisible ? '收起右侧栏' : '展开右侧栏'}
              aria-expanded={isRightPanelVisible}
              onClick={onToggleRightPanel}
              className={cn(
                'titlebar-no-drag absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md outline-none transition-colors',
                'bg-foreground/5 text-foreground/60 hover:bg-foreground/10 hover:text-foreground/80 focus-visible:ring-1 focus-visible:ring-ring'
              )}
            >
              {isRightPanelVisible ? (
                <PanelRightClose className="h-3.5 w-3.5" strokeWidth={1.7} />
              ) : (
                <PanelRightOpen className="h-3.5 w-3.5" strokeWidth={1.7} />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {isRightPanelVisible ? '收起右侧栏' : '展开右侧栏'}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </header>
  )
}
