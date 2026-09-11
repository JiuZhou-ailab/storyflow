// input: Resolved local Pi Skill, workspace identity, authenticated company scope, and publication form values
// output: Upload preview, authenticated publication, persistent result, and immutable installation link
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
import { buildSkillInstallDeepLink, type SkillPublicationMetadata, type SkillMarketPublishResult } from '@craft-agent/shared/skills/marketplace'
import type { ExportResult } from '@craft-agent/shared/resources'
import { getInstalledMarketSlug } from '@/pages/skills-hub-logic'
import { navigate, routes } from '@/lib/navigate'
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
  const [exported, setExported] = useState<ExportResult | null>(null)
  const [published, setPublished] = useState<SkillMarketPublishResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [displayName, setDisplayName] = useState('')
  const [summary, setSummary] = useState('')
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    if (!open || !skill) return
    let active = true
    setVersion('1.0.0')
    setLicense('CC-BY-4.0')
    setTags('')
    setDisplayName(skill.metadata.displayName ?? skill.metadata.name)
    setSummary(skill.metadata.description)
    setVisibility('public')
    setCompanyAvailable(false)
    setVisibilityReady(false)
    setSignedIn(false)
    setExported(null)
    setPublished(null)
    setError(null)
    void Promise.all([
      window.electronAPI.getClientAuthState(),
      window.electronAPI.exportSkill(workspaceId, skill.slug, resolveCatalogCwd(skill, workspaceRootPath)),
      window.electronAPI.listSkillsFromMarket(),
    ]).then(([state, snapshot, catalog]) => {
      if (!active) return
      const internal = Boolean(state.user?.organizationId)
      setSignedIn(state.authenticated)
      setCompanyAvailable(internal)
      setVisibility(internal ? 'company' : 'public')
      const existing = catalog.skills.find(item => item.slug === getInstalledMarketSlug(skill))
      if (existing) {
        const match = /^(\d+)\.(\d+)\.(\d+)(?:-.*)?$/.exec(existing.version)
        if (match) setVersion(`${match[1]}.${match[2]}.${Number(match[3]) + 1}`)
        setLicense(existing.license)
        setTags(existing.tags.join(', '))
        setVisibility(existing.visibility)
      }
      setExported(snapshot)
      setVisibilityReady(true)
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { active = false }
  }, [open, skill, workspaceId, workspaceRootPath, reload, t])

  const handlePublish = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!skill || !exported || publishing || !signedIn) return
    setPublishing(true)
    setError(null)
    try {
      const result = await window.electronAPI.publishSkillToMarket({
        bundle: exported.bundle,
        publication: {
          version,
          displayName,
          summary,
          license,
          tags: tags.split(',').map(tag => tag.trim()).filter(Boolean),
          visibility,
        },
      })
      setPublished(result)
      onPublished?.()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setPublishing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} busy={publishing}>
      <DialogContent size="sm" className="max-h-[85vh] overflow-y-auto">
        {published ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('skillsMarket.published', { name: displayName, version: published.version })}</DialogTitle>
              <DialogDescription>{t(visibility === 'company' ? 'skillsMarket.visibilityCompanyHelp' : 'skillsMarket.visibilityPublicHelp')}</DialogDescription>
            </DialogHeader>
            <p className="text-sm">{t('skillsMarket.publishedHelp')}</p>
            <DialogFooter className="flex-wrap">
              <Button variant="outline" onClick={() => {
                void navigator.clipboard.writeText(buildSkillInstallDeepLink(published))
                  .then(() => toast.success(t('skillsMarket.linkCopied')))
                  .catch(() => toast.error(t('skillsMarket.copyFailed')))
              }}>{t('skillsMarket.copyInstallLink')}</Button>
              <Button onClick={() => { onOpenChange(false); navigate(routes.view.skills()) }}>{t('skillsMarket.viewMarket')}</Button>
            </DialogFooter>
          </>
        ) : (
          <form className="grid gap-5" onSubmit={handlePublish}>
            <DialogHeader>
              <DialogTitle>{t('skillsMarket.publishTitle')}</DialogTitle>
              <DialogDescription>{t('skillsMarket.publishDescription')}</DialogDescription>
            </DialogHeader>
            {error && <div role="alert" className="text-sm text-destructive break-words">
              {error}
              {!visibilityReady && <Button type="button" variant="outline" className="ml-2" onClick={() => setReload(value => value + 1)}>{t('common.retry')}</Button>}
            </div>}
            {exported?.warnings.map((warning, index) => <p key={index} className="text-xs text-muted-foreground">{warning}</p>)}
            {exported && <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">{t('skillsMarket.uploadFiles', { count: exported.bundle.resources.skills?.[0]?.files.length ?? 0 })}</summary>
              <ul className="mt-2 max-h-28 overflow-auto font-mono">
                {exported.bundle.resources.skills?.[0]?.files.map(file => <li key={file.relativePath}>{file.relativePath}</li>)}
              </ul>
            </details>}
            <fieldset disabled={publishing || !visibilityReady} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="skill-market-name">{t('common.name')}</Label>
                <Input id="skill-market-name" value={displayName} onChange={event => setDisplayName(event.target.value)} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="skill-market-summary">{t('common.description')}</Label>
                <Input id="skill-market-summary" value={summary} onChange={event => setSummary(event.target.value)} required />
              </div>
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
                  onValueChange={value => {
                    if (value === 'company' || value === 'public') setVisibility(value)
                  }}
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
            </fieldset>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={publishing}>
                {t('common.cancel')}
              </Button>
              {visibilityReady && !signedIn ? (
                <Button type="button" onClick={() => { onOpenChange(false); navigate(routes.view.settings('profile')) }}>{t('skillsMarket.signInToPublish')}</Button>
              ) : (
                <Button type="submit" disabled={publishing || !visibilityReady}>
                  {publishing ? t('skillsMarket.publishing') : t('skillsMarket.publish')}
                </Button>
              )}
            </DialogFooter>
          </form>
        )}
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
