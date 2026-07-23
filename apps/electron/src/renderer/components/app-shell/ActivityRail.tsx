// input: Project list, shell navigation callbacks, update IPC
// output: Stable foundation icon rail — same items on every surface
// pos: Leftmost chrome; never swaps icon set by library/room mode

import * as React from 'react'
import {
  BookOpenText,
  DatabaseZap,
  Download,
  HelpCircle,
  LayoutGrid,
  Megaphone,
  RefreshCw,
  Search,
  Settings,
  UserCircle,
  Zap,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui/tooltip'
import { cn } from '@/lib/utils'
import { useUpdateChecker } from '@/hooks/useUpdateChecker'
import { getUpdateIndicatorState } from '@/lib/update-indicator'
import { FeedbackDialog } from './FeedbackDialog'
import { ProjectSwitcherPopover } from './ProjectSwitcherPopover'
import type { Workspace } from '../../../shared/types'

export type ActivityRailItemId =
  | 'project-hub'
  | 'writing'
  | 'sources'
  | 'skills'
  | 'settings'
  | 'search'
  | 'account'

interface ActivityRailProps {
  activeItem: ActivityRailItemId
  workspaces?: Workspace[]
  activeWorkspaceId?: string | null
  onSelectProject?: (workspaceId: string) => void
  onCreateProject?: () => void
  onImportProject?: () => void
  onConnectRemoteProject?: () => void
  onWorkspaceCreated?: (workspace: Workspace) => void | Promise<void>
  onOpenProjectInNewWindow?: (workspaceId: string) => void
  onRenameProject?: (workspaceId: string, name: string) => void | Promise<void>
  onRemoveProject?: (workspaceId: string) => void | Promise<void>
  onOpenWritingWorkspace?: () => void
  onOpenSources?: () => void
  onOpenSkills?: () => void
  onOpenSearch?: () => void
  onOpenSettings?: () => void
  onOpenAccount?: () => void
  /**
   * Optional release-notes surface. The rail "更新" control is software update
   * (check / install via auto-update IPC); Whats New stays a secondary path.
   */
  onOpenWhatsNew?: () => void
  whatsNew?: {
    unseen: boolean
    accentColor?: string
    textColor?: string
  }
  /** Controlled project dialog open state. */
  projectMenuOpen?: boolean
  onProjectMenuOpenChange?: (open: boolean) => void
}

interface RailButtonProps {
  label: string
  icon: React.ReactNode
  active?: boolean
  onClick?: () => void
  accent?: string
  accentText?: string
  /** Soft highlight without custom colors (e.g. update ready). */
  emphasis?: boolean
  dataTutorial?: string
  disabled?: boolean
}

export const ACTIVITY_RAIL_WIDTH = 48

const railButtonClassName = (active?: boolean, accent?: boolean, emphasis?: boolean) => cn(
  'relative flex h-9 w-9 items-center justify-center rounded-[8px] outline-none transition-colors',
  'text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground',
  'focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35',
  active && 'bg-foreground/[0.07] text-foreground',
  emphasis && !accent && 'bg-accent/10 text-accent hover:bg-accent/15',
  accent && 'hover:brightness-105',
)

export function ActivityRail({
  activeItem,
  workspaces = [],
  activeWorkspaceId = null,
  onSelectProject,
  onCreateProject,
  onImportProject,
  onConnectRemoteProject,
  onWorkspaceCreated,
  onOpenProjectInNewWindow,
  onRenameProject,
  onRemoveProject,
  onOpenWritingWorkspace,
  onOpenSources,
  onOpenSkills,
  onOpenSearch,
  onOpenSettings,
  onOpenAccount,
  onOpenWhatsNew,
  whatsNew,
  projectMenuOpen,
  onProjectMenuOpenChange,
}: ActivityRailProps) {
  const [feedbackOpen, setFeedbackOpen] = React.useState(false)
  const [uncontrolledMenuOpen, setUncontrolledMenuOpen] = React.useState(false)
  const menuOpen = projectMenuOpen ?? uncontrolledMenuOpen
  const setMenuOpen = onProjectMenuOpenChange ?? setUncontrolledMenuOpen
  const canManageProjects = typeof onSelectProject === 'function'
  // No project yet: open project manager instead of dead ends.
  const openProjectPicker = React.useCallback(() => {
    if (canManageProjects) setMenuOpen(true)
  }, [canManageProjects, setMenuOpen])
  const writingAction = onOpenWritingWorkspace ?? (canManageProjects ? openProjectPicker : undefined)
  const sourcesAction = onOpenSources ?? (canManageProjects ? openProjectPicker : undefined)
  const skillsAction = onOpenSkills ?? (canManageProjects ? openProjectPicker : undefined)
  const searchAction = onOpenSearch ?? (canManageProjects ? openProjectPicker : undefined)
  const updateChecker = useUpdateChecker()
  const updateIndicator = getUpdateIndicatorState(updateChecker.updateInfo)

  const handleUpdateClick = React.useCallback(() => {
    if (updateIndicator?.kind === 'ready' && updateIndicator.actionable) {
      void updateChecker.installUpdate()
      return
    }
    if (updateIndicator?.kind === 'downloading' || updateIndicator?.kind === 'installing') {
      return
    }
    void updateChecker.checkForUpdates()
  }, [updateChecker.checkForUpdates, updateChecker.installUpdate, updateIndicator])

  const updateLabel = updateIndicator?.kind === 'ready'
    ? `重启以更新${updateIndicator.version ? ` v${updateIndicator.version}` : ''}`
    : updateIndicator?.kind === 'downloading'
      ? `下载中${updateIndicator.version ? ` v${updateIndicator.version}` : ''}…`
      : updateIndicator?.kind === 'installing'
        ? '正在安装更新…'
        : '检查更新'

  const updateIcon = updateIndicator?.kind === 'ready'
    ? <Download className="h-[18px] w-[18px]" />
    : (
      <RefreshCw
        className={cn(
          'h-[18px] w-[18px]',
          (updateIndicator?.kind === 'downloading' || updateIndicator?.kind === 'installing') && 'animate-spin',
        )}
      />
    )

  const projectTrigger = (
    <button
      type="button"
      aria-label="项目"
      title="项目"
      aria-haspopup="dialog"
      aria-expanded={menuOpen}
      data-tutorial="activity-project-hub"
      className={railButtonClassName(menuOpen || activeItem === 'project-hub')}
    >
      {(menuOpen || activeItem === 'project-hub') ? (
        <span
          className="absolute left-[-4px] h-5 w-[2px] rounded-full bg-accent"
          aria-hidden="true"
        />
      ) : null}
      <LayoutGrid className="h-[18px] w-[18px]" />
    </button>
  )

  return (
    <aside
      data-testid="activity-rail"
      aria-label="主导航"
      className="titlebar-no-drag flex h-full shrink-0 flex-col items-center justify-between border-r border-border/35 bg-background/80 px-1 py-2"
      style={{ width: ACTIVITY_RAIL_WIDTH }}
    >
      {/* Foundation layer: icon set is fixed. Only active/disabled state changes. */}
      <nav className="flex flex-col items-center gap-1" aria-label="项目与工作区">
        {canManageProjects ? (
          <ProjectSwitcherPopover
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            onSelectProject={onSelectProject}
            onCreateProject={onCreateProject}
            onImportProject={onImportProject}
            onConnectRemoteProject={onConnectRemoteProject}
            onWorkspaceCreated={onWorkspaceCreated}
            onOpenProjectInNewWindow={onOpenProjectInNewWindow}
            onRenameProject={onRenameProject}
            onRemoveProject={onRemoveProject}
            open={menuOpen}
            onOpenChange={setMenuOpen}
          >
            {projectTrigger}
          </ProjectSwitcherPopover>
        ) : (
          <RailButton
            label="项目"
            icon={<LayoutGrid className="h-[18px] w-[18px]" />}
            active={activeItem === 'project-hub'}
            dataTutorial="activity-project-hub"
            disabled
          />
        )}

        <RailButton
          label="写作工作区"
          icon={<BookOpenText className="h-[18px] w-[18px]" />}
          active={activeItem === 'writing'}
          onClick={writingAction}
          dataTutorial="activity-writing"
        />
        <RailButton
          label="数据源"
          icon={<DatabaseZap className="h-[18px] w-[18px]" />}
          active={activeItem === 'sources'}
          onClick={sourcesAction}
          dataTutorial="activity-sources"
        />
        <RailButton
          label="技能"
          icon={<Zap className="h-[18px] w-[18px]" />}
          active={activeItem === 'skills'}
          onClick={skillsAction}
          dataTutorial="activity-skills"
        />
        <RailButton
          label="搜索"
          icon={<Search className="h-[18px] w-[18px]" />}
          active={activeItem === 'search'}
          onClick={searchAction}
          dataTutorial="activity-search"
        />
      </nav>

      <nav className="flex flex-col items-center gap-1" aria-label="账户与帮助">
        <RailButton
          label={updateLabel}
          icon={updateIcon}
          onClick={handleUpdateClick}
          disabled={updateIndicator?.kind === 'downloading' || updateIndicator?.kind === 'installing'}
          emphasis={updateIndicator?.kind === 'ready'}
          dataTutorial="activity-check-updates"
        />
        {onOpenWhatsNew ? (
          <RailButton
            label={whatsNew?.unseen ? '新功能（未读）' : '新功能'}
            icon={<Megaphone className="h-[18px] w-[18px]" />}
            onClick={onOpenWhatsNew}
            accent={whatsNew?.unseen ? whatsNew.accentColor : undefined}
            accentText={whatsNew?.unseen ? whatsNew.textColor : undefined}
            dataTutorial="activity-whats-new"
          />
        ) : null}
        <RailButton
          label="设置"
          icon={<Settings className="h-[18px] w-[18px]" />}
          active={activeItem === 'settings'}
          onClick={onOpenSettings}
          dataTutorial="activity-settings"
        />
        {onOpenAccount ? (
          <RailButton
            label="账户与积分"
            icon={<UserCircle className="h-[18px] w-[18px]" />}
            active={activeItem === 'account'}
            onClick={onOpenAccount}
            dataTutorial="activity-account"
          />
        ) : null}
        <RailButton
          label="帮助与反馈"
          icon={<HelpCircle className="h-[18px] w-[18px]" />}
          onClick={() => setFeedbackOpen(true)}
          dataTutorial="activity-feedback"
        />
        <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
      </nav>
    </aside>
  )
}

function RailButton({
  label,
  icon,
  active,
  onClick,
  accent,
  accentText,
  emphasis,
  dataTutorial,
  disabled,
}: RailButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-current={active ? 'page' : undefined}
          data-tutorial={dataTutorial}
          disabled={disabled || !onClick}
          onClick={onClick}
          style={accent ? { backgroundColor: accent, color: accentText ?? '#ffffff' } : undefined}
          className={railButtonClassName(active, Boolean(accent), emphasis)}
        >
          {active || emphasis ? (
            <span
              className="absolute left-[-4px] h-5 w-[2px] rounded-full bg-accent"
              aria-hidden="true"
            />
          ) : null}
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}
