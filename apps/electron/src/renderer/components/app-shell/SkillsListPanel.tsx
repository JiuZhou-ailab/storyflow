// input: Resolved runtime Skills, workspace identity, and Skills Market navigation
// output: Overlay-aware Skill list, local management actions, and public discovery entry
// pos: Skills navigator surface; installation remains a verified ResourceBundle import

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Compass, Zap } from 'lucide-react'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { EntityPanel } from '@/components/ui/entity-panel'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { skillSelection } from '@/hooks/useEntitySelection'
import { SkillMenu } from './SkillMenu'
import { SendResourceToWorkspaceDialog } from './SendResourceToWorkspaceDialog'
import { resolveSkillsMarketEntry } from '@/lib/skills-market-entry'
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover'
import { FREE_CONVERSATION_WORKSPACE_ID } from '@craft-agent/shared/protocol'
import type { LoadedSkill, Workspace } from '../../../shared/types'

const skillsMarketEntry = resolveSkillsMarketEntry(import.meta.env.VITE_STORYFLOW_SKILLS_MARKET_ENABLED)

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

export function AddSkillPopover({
  workspace,
  trigger,
}: {
  workspace: Workspace
  trigger: React.ReactNode
}) {
  const isProject = workspace.id !== FREE_CONVERSATION_WORKSPACE_ID
  return (
    <EditPopover
      trigger={trigger}
      {...getEditConfig(isProject ? 'add-skill' : 'add-global-skill', workspace.rootPath, workspace.id)}
      conversationWorkspaceId={FREE_CONVERSATION_WORKSPACE_ID}
      workingDirectory="none"
    />
  )
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
      {skillsMarketEntry && (
        <div className="px-2 pb-2">
          <button
            type="button"
            className="flex min-h-9 w-full items-center gap-2 rounded-lg border border-border/70 bg-background px-3 text-left text-xs font-medium transition-colors hover:bg-foreground/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => window.electronAPI.openUrl(skillsMarketEntry.origin)}
          >
            <Compass className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="flex-1">{t('skillsList.discover', '发现 Skills')}</span>
            <span aria-hidden="true">↗</span>
          </button>
        </div>
      )}
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
            {activeWorkspace && (
              <AddSkillPopover
                workspace={activeWorkspace}
                trigger={(
                  <button
                    type="button"
                    className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors"
                  >
                    {t('skillsList.addSkill')}
                  </button>
                )}
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
