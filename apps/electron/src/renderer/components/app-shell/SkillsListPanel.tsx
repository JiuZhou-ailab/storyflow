// input: Active project Skills, workspace identity, and Skills Market navigation
// output: Project Skill list, local management actions, and public discovery entry
// pos: Skills navigator surface; installation remains a verified ResourceBundle import

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Compass, Zap } from 'lucide-react'
import { DEFAULT_SKILLS_MARKET_ORIGIN } from '@craft-agent/shared/skills/marketplace'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { EntityPanel } from '@/components/ui/entity-panel'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { skillSelection } from '@/hooks/useEntitySelection'
import { SkillMenu } from './SkillMenu'
import { SendResourceToWorkspaceDialog } from './SendResourceToWorkspaceDialog'
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover'
import type { LoadedSkill, Workspace } from '../../../shared/types'

export interface SkillsListPanelProps {
  skills: LoadedSkill[]
  onDeleteSkill: (skillSlug: string) => void
  onSkillClick: (skill: LoadedSkill) => void
  selectedSkillSlug?: string | null
  workspaceId?: string
  workspaceRootPath?: string
  activeWorkspace?: Workspace | null
  workspaces?: Workspace[]
  className?: string
}

export function SkillsListPanel({
  skills,
  onDeleteSkill,
  onSkillClick,
  selectedSkillSlug,
  workspaceId,
  workspaceRootPath,
  activeWorkspace,
  workspaces = [],
  className,
}: SkillsListPanelProps) {
  const { t } = useTranslation()
  const canRevealLocally = !activeWorkspace?.remoteServer
  const hasOtherWorkspaces = workspaces.length > 1

  // Send to Workspace dialog state
  const [sendDialogOpen, setSendDialogOpen] = React.useState(false)
  const [sendResourceSlug, setSendResourceSlug] = React.useState<string | null>(null)
  const [sendResourceLabel, setSendResourceLabel] = React.useState('')

  return (
    <>
    <div className="px-2 pb-2">
      <button
        type="button"
        className="flex min-h-9 w-full items-center gap-2 rounded-lg border border-border/70 bg-background px-3 text-left text-xs font-medium transition-colors hover:bg-foreground/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => window.electronAPI.openUrl(DEFAULT_SKILLS_MARKET_ORIGIN)}
      >
        <Compass className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="flex-1">{t('skillsList.discover', '发现 Skills')}</span>
        <span aria-hidden="true">↗</span>
      </button>
    </div>
    <EntityPanel<LoadedSkill>
      items={skills}
      getId={(s) => s.slug}
      selection={skillSelection}
      selectedId={selectedSkillSlug}
      onItemClick={onSkillClick}
      className={className}
      emptyState={
        <EntityListEmptyScreen
          icon={<Zap />}
          title={t('skillsList.noSkillsConfigured')}
          description={t('skillsList.emptyDescription')}
          docKey="skills"
        >
          {workspaceRootPath && (
            <EditPopover
              align="center"
              trigger={
                <button className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors">
                  {t('skillsList.addSkill')}
                </button>
              }
              {...getEditConfig('add-skill', workspaceRootPath)}
            />
          )}
        </EntityListEmptyScreen>
      }
      mapItem={(skill) => ({
        icon: <SkillAvatar skill={skill} size="sm" workspaceId={workspaceId} />,
        title: skill.metadata.displayName ?? skill.metadata.name,
        badges: <span className="truncate">{skill.metadata.description}</span>,
        menu: (
          <SkillMenu
            skillSlug={skill.slug}
            skillName={skill.metadata.displayName ?? skill.metadata.name}
            onOpenInNewWindow={() => window.electronAPI.openUrl(`craftagents://skills/skill/${skill.slug}?window=focused`)}
            onShowInFinder={() => {
              if (canRevealLocally) {
                void window.electronAPI.showInFolder(`${skill.path}/SKILL.md`)
              }
            }}
            canShowInFinder={canRevealLocally}
            onDelete={() => onDeleteSkill(skill.slug)}
            canDelete
            deleteLabel={t('skillsList.deleteSkill')}
            onSendToWorkspace={hasOtherWorkspaces ? () => {
              setSendResourceSlug(skill.slug)
              setSendResourceLabel(skill.metadata.displayName ?? skill.metadata.name)
              setSendDialogOpen(true)
            } : undefined}
          />
        ),
      })}
    />

    {/* Send to Workspace dialog */}
    {sendResourceSlug && (
      <SendResourceToWorkspaceDialog
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
        resourceType="skill"
        resourceIds={[sendResourceSlug]}
        resourceLabel={sendResourceLabel}
        workspaces={workspaces}
        activeWorkspaceId={workspaceId ?? null}
      />
    )}
    </>
  )
}
