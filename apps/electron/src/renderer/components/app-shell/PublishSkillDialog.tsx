// input: Resolved local Pi Skill, workspace identity, authenticated company scope, and publication form values
// output: Authenticated company or public publication through the main-process Market client
// pos: Minimal user confirmation surface for sharing one Skill with an explicit audience

import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { SkillPublicationMetadata } from '@craft-agent/shared/skills/marketplace'
import type { LoadedSkill } from '../../../shared/types'

interface PublishSkillDialogProps {
  skill: LoadedSkill | null
  workspaceId: string
  workspaceRootPath: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onPublished?: () => void
}

export function PublishSkillDialog({
  skill,
  workspaceId,
  workspaceRootPath,
  open,
  onOpenChange,
  onPublished,
}: PublishSkillDialogProps) {
  const { t } = useTranslation()
  const [version, setVersion] = useState('1.0.0')
  const [license, setLicense] = useState('CC-BY-4.0')
  const [tags, setTags] = useState('')
  const [visibility, setVisibility] = useState<SkillPublicationMetadata['visibility']>('public')
  const [companyAvailable, setCompanyAvailable] = useState(false)
  const [visibilityReady, setVisibilityReady] = useState(false)
  const [publishing, setPublishing] = useState(false)

  useEffect(() => {
    if (!open) return
    let active = true
    setVersion('1.0.0')
    setLicense('CC-BY-4.0')
    setTags('')
    setVisibility('public')
    setCompanyAvailable(false)
    setVisibilityReady(false)
    void window.electronAPI.getClientAuthState()
      .then((state) => {
        if (!active) return
        const internal = Boolean(state.user?.organizationId)
        setCompanyAvailable(internal)
        setVisibility(internal ? 'company' : 'public')
      })
      .finally(() => {
        if (active) setVisibilityReady(true)
      })
    return () => { active = false }
  }, [open, skill?.slug])

  const handlePublish = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!skill) return
    setPublishing(true)
    try {
      const exported = await window.electronAPI.exportSkill(
        workspaceId,
        skill.slug,
        resolveCatalogCwd(skill, workspaceRootPath),
      )
      const result = await window.electronAPI.publishSkillToMarket({
        bundle: exported.bundle,
        publication: {
          version,
          displayName: skill.metadata.displayName ?? skill.metadata.name,
          summary: skill.metadata.description,
          license,
          tags: tags.split(',').map(tag => tag.trim()).filter(Boolean),
          visibility,
        },
      })
      toast.success(t('skillsMarket.published', {
        name: skill.metadata.displayName ?? skill.metadata.name,
        version: result.version,
      }))
      onPublished?.()
      onOpenChange(false)
    } catch (error) {
      toast.error(t('skillsMarket.publishFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setPublishing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} busy={publishing}>
      <DialogContent size="sm">
        <form className="grid gap-5" onSubmit={handlePublish}>
          <DialogHeader>
            <DialogTitle>{t('skillsMarket.publishTitle')}</DialogTitle>
            <DialogDescription>{t('skillsMarket.publishDescription')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="skill-market-version">{t('skillsMarket.version')}</Label>
              <Input id="skill-market-version" value={version} onChange={event => setVersion(event.target.value)} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="skill-market-license">{t('skillsMarket.license')}</Label>
              <Input id="skill-market-license" value={license} onChange={event => setLicense(event.target.value)} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="skill-market-visibility">
                {t('skillsMarket.visibility', '可见范围')}
              </Label>
              <Select
                value={visibility}
                onValueChange={value => setVisibility(value as SkillPublicationMetadata['visibility'])}
                disabled={!visibilityReady}
              >
                <SelectTrigger id="skill-market-visibility">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {companyAvailable ? (
                    <SelectItem value="company">
                      {t('skillsMarket.visibilityCompany', '公司内部')}
                    </SelectItem>
                  ) : null}
                  <SelectItem value="public">
                    {t('skillsMarket.visibilityPublic', '公开')}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {visibility === 'company'
                  ? t('skillsMarket.visibilityCompanyHelp', '仅公司成员可以发现和安装')
                  : t('skillsMarket.visibilityPublicHelp', '所有 Storyflow 用户都可以发现和安装')}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="skill-market-tags">{t('skillsMarket.tags')}</Label>
              <Input
                id="skill-market-tags"
                value={tags}
                onChange={event => setTags(event.target.value)}
                placeholder={t('skillsMarket.tagsPlaceholder')}
              />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {visibility === 'company'
                ? t('skillsMarket.licenseDeclarationCompany', 'AI 审核通过后将立即在公司内部发布。你声明自己有权按该许可分享此版本。')
                : t('skillsMarket.licenseDeclaration')}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={publishing}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={publishing || !visibilityReady}>
              {publishing ? t('skillsMarket.publishing') : t('skillsMarket.publish')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function resolveCatalogCwd(skill: LoadedSkill, workspaceRootPath: string): string {
  if (skill.scope !== 'project') return workspaceRootPath
  const normalized = skill.path.replace(/\\/g, '/')
  for (const marker of ['/.pi/skills/', '/.agents/skills/']) {
    const index = normalized.lastIndexOf(marker)
    if (index >= 0) return normalized.slice(0, index)
  }
  return workspaceRootPath
}
