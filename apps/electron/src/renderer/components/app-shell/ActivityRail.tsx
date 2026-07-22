// input: Room/library surface mode, project list, and shell navigation callbacks
// output: Icon rail with project switcher at the original top slot plus room utilities
// pos: Leftmost chrome; project entry opens a list popover instead of leaving the room

import * as React from 'react'
import {
  BookOpenText,
  HelpCircle,
  LayoutGrid,
  Megaphone,
  Search,
  Settings,
  UserCircle,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui/tooltip'
import { cn } from '@/lib/utils'
import { FeedbackDialog } from './FeedbackDialog'
import { ProjectSwitcherPopover } from './ProjectSwitcherPopover'
import type { Workspace } from '../../../shared/types'

export type ActivityRailItemId = 'project-hub' | 'writing' | 'settings' | 'search' | 'account'

/** library = exclusive ProjectHub page; room = project workspace shell */
export type ActivityRailSurface = 'library' | 'room'

interface ActivityRailProps {
  surface?: ActivityRailSurface
  activeItem: ActivityRailItemId
  workspaces?: Workspace[]
  activeWorkspaceId?: string | null
  onSelectProject?: (workspaceId: string) => void
  /** Full ProjectHub (manage / create / import). Used from library surface or switcher footer. */
  onOpenProjectHub?: () => void
  onCreateProject?: () => void
  onOpenWritingWorkspace?: () => void
  onOpenSearch?: () => void
  onOpenSettings?: () => void
  onOpenAccount?: () => void
  onOpenWhatsNew?: () => void
  whatsNew?: {
    unseen: boolean
    accentColor?: string
    textColor?: string
  }
}

interface RailButtonProps {
  label: string
  icon: React.ReactNode
  active?: boolean
  onClick?: () => void
  accent?: string
  accentText?: string
  dataTutorial?: string
  disabled?: boolean
}

export const ACTIVITY_RAIL_WIDTH = 48

const railButtonClassName = (active?: boolean, accent?: boolean) => cn(
  'relative flex h-9 w-9 items-center justify-center rounded-[8px] outline-none transition-colors',
  'text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground',
  'focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35',
  active && 'bg-foreground/[0.07] text-foreground',
  accent && 'hover:brightness-105',
)

export function ActivityRail({
  surface = 'room',
  activeItem,
  workspaces = [],
  activeWorkspaceId = null,
  onSelectProject,
  onOpenProjectHub,
  onCreateProject,
  onOpenWritingWorkspace,
  onOpenSearch,
  onOpenSettings,
  onOpenAccount,
  onOpenWhatsNew,
  whatsNew,
}: ActivityRailProps) {
  const [feedbackOpen, setFeedbackOpen] = React.useState(false)
  const [projectSwitcherOpen, setProjectSwitcherOpen] = React.useState(false)
  const isLibrary = surface === 'library'
  const canSwitchProjects = !isLibrary && typeof onSelectProject === 'function'

  return (
    <aside
      data-testid="activity-rail"
      data-surface={surface}
      aria-label={isLibrary ? '作品库导航' : '主导航'}
      className="titlebar-no-drag flex h-full shrink-0 flex-col items-center justify-between border-r border-border/35 bg-background/80 px-1 py-2"
      style={{ width: ACTIVITY_RAIL_WIDTH }}
    >
      <nav className="flex flex-col items-center gap-1" aria-label={isLibrary ? '作品库' : '项目与工作区'}>
        {canSwitchProjects ? (
          <ProjectSwitcherPopover
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            onSelectProject={onSelectProject}
            onManageProjects={onOpenProjectHub}
            onCreateProject={onCreateProject}
            open={projectSwitcherOpen}
            onOpenChange={setProjectSwitcherOpen}
          >
            <button
              type="button"
              aria-label="项目"
              title="项目"
              aria-haspopup="dialog"
              aria-expanded={projectSwitcherOpen}
              data-tutorial="activity-project-hub"
              className={railButtonClassName(projectSwitcherOpen)}
            >
              {projectSwitcherOpen ? (
                <span
                  className="absolute left-[-4px] h-5 w-[2px] rounded-full bg-accent"
                  aria-hidden="true"
                />
              ) : null}
              <LayoutGrid className="h-[18px] w-[18px]" />
            </button>
          </ProjectSwitcherPopover>
        ) : (
          <RailButton
            label={isLibrary ? '作品库' : '项目'}
            icon={<LayoutGrid className="h-[18px] w-[18px]" />}
            active={activeItem === 'project-hub'}
            onClick={onOpenProjectHub}
            dataTutorial="activity-project-hub"
            disabled={!onOpenProjectHub}
          />
        )}

        {!isLibrary ? (
          <>
            <RailButton
              label="写作工作区"
              icon={<BookOpenText className="h-[18px] w-[18px]" />}
              active={activeItem === 'writing'}
              onClick={onOpenWritingWorkspace}
              dataTutorial="activity-writing"
            />
            <RailButton
              label="搜索"
              icon={<Search className="h-[18px] w-[18px]" />}
              active={activeItem === 'search'}
              onClick={onOpenSearch}
              dataTutorial="activity-search"
            />
          </>
        ) : null}
      </nav>

      <nav className="flex flex-col items-center gap-1" aria-label="账户与帮助">
        {onOpenWhatsNew ? (
          <RailButton
            label="更新"
            icon={<Megaphone className="h-[18px] w-[18px]" />}
            onClick={onOpenWhatsNew}
            accent={whatsNew?.unseen ? whatsNew.accentColor : undefined}
            accentText={whatsNew?.textColor}
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
          className={railButtonClassName(active, Boolean(accent))}
        >
          {active ? (
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
