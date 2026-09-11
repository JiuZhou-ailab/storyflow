// input: External immutable Skill identity and the currently selected project
// output: Persistent installation confirmation, retry, and access to the installed Skill
// pos: External-link consumption surface; authenticated bytes and project writes stay behind Electron APIs

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import type { MarketSkillSummary } from '@craft-agent/shared/skills/marketplace'
import { skillsAtom } from '@/atoms/skills'
import { windowRuntimeWorkspaceAtom } from '@/atoms/sessions'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { installMarketSkill } from '@/lib/skill-market-install'
import { navigate, routes } from '@/lib/navigate'
import { getInstalledMarketSlug } from '@/pages/skills-hub-logic'

export type MarketSkillInstallRequest = Pick<MarketSkillSummary, 'slug' | 'version' | 'sha256'>

export function MarketSkillInstallDialog({ request, workspaceId, onClose }: {
  request: MarketSkillInstallRequest
  workspaceId: string | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const workspace = useAtomValue(windowRuntimeWorkspaceAtom)
  const skills = useAtomValue(skillsAtom)
  const currentWorkspaceId = React.useRef(workspaceId)
  currentWorkspaceId.current = workspaceId
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<{ workspaceId: string; status: 'installed' | 'exists' } | null>(null)
  const completed = result?.workspaceId === workspaceId ? result : null
  const installed = skills.find(skill => getInstalledMarketSlug(skill) === request.slug)

  async function install() {
    if (!workspaceId || busy) return
    const target = workspaceId
    setBusy(true)
    setError(null)
    try {
      const status = await installMarketSkill(window.electronAPI, request, target, () => currentWorkspaceId.current === target)
      setResult({ workspaceId: target, status })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }} busy={busy}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t('skillsMarket.installTitle')}</DialogTitle>
          <DialogDescription>{request.slug} · v{request.version}</DialogDescription>
        </DialogHeader>
        <p className="text-sm">{t('skillsMarket.installProject', { name: workspace?.name ?? workspaceId ?? '—' })}</p>
        <p className="text-xs text-muted-foreground">{t('skillsMarket.installHelp')}</p>
        {completed && <p role="status" className="text-sm">{t(completed.status === 'installed' ? 'skillsMarket.imported' : 'skillsMarket.exists', { slug: request.slug })}</p>}
        {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>{t('common.close')}</Button>
          {completed && installed ? (
            <Button onClick={() => {
              onClose()
              navigate(routes.action.newSession({ workspaceId: workspaceId!, input: `[skill:${installed.slug}] ` }))
            }}>{t('skillsHub.use')}</Button>
          ) : completed ? (
            <Button onClick={() => { onClose(); navigate(routes.view.skills()) }}>{t('skillsHub.installed')}</Button>
          ) : (
            <Button disabled={!workspaceId || busy} onClick={() => void install()}>
              {busy ? t('skillsHub.installing') : error ? t('common.retry') : t('skillsHub.install')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
