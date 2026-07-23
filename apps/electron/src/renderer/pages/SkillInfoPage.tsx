// input: Workspace skill slug, workspace id, and AppShell-populated skills atom
// output: Skill metadata, instructions, permissions, and explicit edit actions
// pos: Detail page for inspecting and maintaining reusable agent skills

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { useCallback } from 'react'
import { usePlatform } from '@craft-agent/ui'
import { Check, X, Minus } from 'lucide-react'
import { getEditConfig } from '@/components/ui/EditPopover'
import { ResourceEditActions } from '@/components/ui/resource-edit-actions'
import { toast } from 'sonner'
import { SkillMenu } from '@/components/app-shell/SkillMenu'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { routes, navigate } from '@/lib/navigate'
import { skillsAtom } from '@/atoms/skills'
import {
  Info_Page,
  Info_Section,
  Info_Table,
  Info_Markdown,
} from '@/components/info'

interface SkillInfoPageProps {
  skillSlug: string
  workspaceId: string
  canRevealLocally?: boolean
}

export default function SkillInfoPage({ skillSlug, workspaceId, canRevealLocally = true }: SkillInfoPageProps) {
  const { t } = useTranslation()
  const { onOpenFile } = usePlatform()
  const skills = useAtomValue(skillsAtom)
  const skill = skills.find((s) => s.slug === skillSlug) ?? null
  const displayName = skill?.metadata.displayName ?? skill?.metadata.name ?? skillSlug

  // Handle open in finder
  const handleOpenInFinder = useCallback(async () => {
    if (!skill) return

    try {
      if (!canRevealLocally) return
      await window.electronAPI.showInFolder(`${skill.path}/SKILL.md`)
    } catch (err) {
      console.error('Failed to open skill in finder:', err)
    }
  }, [canRevealLocally, skill])

  // Handle delete
  const handleDelete = useCallback(async () => {
    if (!skill) return

    try {
      await window.electronAPI.deleteSkill(workspaceId, skillSlug)
      toast.success(t('skillInfo.deletedSkill', { name: displayName }))
      navigate(routes.view.skills())
    } catch (err) {
      toast.error(t('skillInfo.failedToDelete'), {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }, [displayName, skill, workspaceId, skillSlug])

  // Handle opening in new window
  const handleOpenInNewWindow = useCallback(() => {
    window.electronAPI.openUrl(`craftagents://skills/skill/${skillSlug}?window=focused`)
  }, [skillSlug])

  // Get skill name for header
  const skillName = displayName
  const canDeleteSkill = Boolean(skill)

  // Format path to show just the skill-relative portion (skills/{slug}/)
  const formatPath = (path: string) => {
    const skillsIndex = path.indexOf('/skills/')
    if (skillsIndex !== -1) {
      return path.slice(skillsIndex + 1) // Remove leading slash, keep "skills/{slug}/..."
    }
    return path
  }

  // Open the skill folder in Finder with SKILL.md selected
  const handleLocationClick = () => {
    if (!skill) return
    // Show the SKILL.md file in Finder (this reveals the enclosing folder with file focused)
    if (!canRevealLocally) return
    window.electronAPI.showInFolder(`${skill.path}/SKILL.md`)
  }

  const handleOpenInEditor = useCallback(async () => {
    if (!skill) return
    try {
      if (canRevealLocally) {
        await window.electronAPI.openSkillInEditor(workspaceId, skillSlug)
        return
      }
      onOpenFile?.(`${skill.path}/SKILL.md`)
    } catch (err) {
      toast.error('无法打开编辑器', {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }, [canRevealLocally, onOpenFile, skill, skillSlug, workspaceId])

  const renderEditActions = (configKey: 'skill-metadata' | 'skill-instructions') => {
    if (!skill) return null
    const filePath = `${skill.path}/SKILL.md`
    // Primary path: open SKILL.md in the system editor. AI assist stays secondary.
    return (
      <ResourceEditActions
        filePath={filePath}
        canEditFile={canRevealLocally}
        onOpenFile={handleOpenInEditor}
        {...getEditConfig(configKey, skill.path)}
      />
    )
  }

  return (
    <Info_Page
      empty={!skill && skills.length > 0 ? t('skillInfo.notFound') : undefined}
    >
      <Info_Page.Header
        title={skillName}
        titleMenu={
          <SkillMenu
            skillSlug={skillSlug}
            skillName={skillName}
            onOpenInNewWindow={handleOpenInNewWindow}
            onShowInFinder={handleOpenInFinder}
            canShowInFinder={canRevealLocally}
            onDelete={canDeleteSkill ? handleDelete : undefined}
            canDelete={canDeleteSkill}
            deleteLabel={canDeleteSkill ? t('skillInfo.deleteSkill') : t('skillInfo.managedByProject')}
          />
        }
      />

      {skill && (
        <Info_Page.Content>
          {/* Hero: Avatar, title, and description */}
          <Info_Page.Hero
            avatar={<SkillAvatar skill={skill} fluid workspaceId={workspaceId} />}
            title={displayName}
            tagline={skill.metadata.description}
          />

          {/* Metadata */}
          <Info_Section
            title={t('skillInfo.metadata')}
            actions={renderEditActions('skill-metadata')}
          >
            <Info_Table>
              <Info_Table.Row label={t('common.slug')} value={skill.slug} />
              <Info_Table.Row label={t('common.name')}>{displayName}</Info_Table.Row>
              <Info_Table.Row label={t('common.description')}>
                {skill.metadata.description}
              </Info_Table.Row>
              <Info_Table.Row label={t('common.location')}>
                <button
                  onClick={handleLocationClick}
                  className="hover:underline cursor-pointer text-left"
                >
                  {formatPath(skill.path)}
                </button>
              </Info_Table.Row>
              {skill.metadata.requiredSources && skill.metadata.requiredSources.length > 0 && (
                <Info_Table.Row label={t('skillInfo.requiredSources')}>
                  {skill.metadata.requiredSources.join(', ')}
                </Info_Table.Row>
              )}
            </Info_Table>
          </Info_Section>

          {/* Permission Modes */}
          {skill.metadata.alwaysAllow && skill.metadata.alwaysAllow.length > 0 && (
            <Info_Section title={t('skillInfo.permissionModes')}>
              <div className="space-y-2 px-4 py-3">
                <p className="text-xs text-muted-foreground mb-3">
                  {t('skillInfo.permissionModesDesc')}
                </p>
                <div className="rounded-[8px] border border-border/50 overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      <tr className="border-b border-border/30">
                        <td className="px-3 py-2 font-medium text-muted-foreground w-[140px]">{t('skillInfo.explore')}</td>
                        <td className="px-3 py-2 flex items-center gap-2">
                          <X className="h-3.5 w-3.5 text-destructive shrink-0" />
                          <span className="text-foreground/80">{t('skillInfo.exploreDesc')}</span>
                        </td>
                      </tr>
                      <tr className="border-b border-border/30">
                        <td className="px-3 py-2 font-medium text-muted-foreground">{t('skillInfo.askToEdit')}</td>
                        <td className="px-3 py-2 flex items-center gap-2">
                          <Check className="h-3.5 w-3.5 text-success shrink-0" />
                          <span className="text-foreground/80">{t('skillInfo.askToEditDesc')}</span>
                        </td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2 font-medium text-muted-foreground">{t('skillInfo.auto')}</td>
                        <td className="px-3 py-2 flex items-center gap-2">
                          <Minus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-foreground/80">{t('skillInfo.autoDesc')}</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </Info_Section>
          )}

          {/* Instructions */}
          <Info_Section
            title={t('skillInfo.instructions')}
            actions={renderEditActions('skill-instructions')}
          >
            <Info_Markdown maxHeight={540} fullscreen>
              {skill.content || t('skillInfo.noInstructions')}
            </Info_Markdown>
          </Info_Section>

        </Info_Page.Content>
      )}
    </Info_Page>
  )
}
