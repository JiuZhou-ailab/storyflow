// input: Host storage settings and the native directory picker
// output: Visible deferred storage migration, cancellation and failure recovery
// pos: Application settings for durable Free Conversation files
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FreeConversationStorage } from '@craft-agent/shared/workspaces'
import { Button } from '@/components/ui/button'
import { SettingsSection, SettingsCard, SettingsRow } from '@/components/settings'

export function FreeConversationStorageSettings() {
  const { t } = useTranslation()
  const [storage, setStorage] = useState<FreeConversationStorage>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    window.electronAPI.getFreeConversationStorage().then(setStorage).catch(error => setError(String(error)))
  }, [])
  async function change(cancel = false) {
    setBusy(true)
    setError('')
    try {
      const parent = cancel ? null : await window.electronAPI.openFolderDialog()
      if (!cancel && parent === null) return
      setStorage(await window.electronAPI.setFreeConversationStorage(parent))
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally { setBusy(false) }
  }
  return <SettingsSection title={t('settings.freeStorage.title')}>
    <SettingsCard>
      <SettingsRow label={t('settings.freeStorage.location')} description={storage?.path}>
        <Button variant="outline" size="sm" disabled={busy || !storage} onClick={() => void change()}>{t('settings.freeStorage.choose')}</Button>
      </SettingsRow>
      <p className="px-4 pb-3 text-xs text-muted-foreground">{t('settings.freeStorage.description')}</p>
      {storage?.pendingPath && <SettingsRow label={t('settings.freeStorage.pending')} description={storage.pendingPath}>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void change(true)}>{t('settings.freeStorage.cancel')}</Button>
      </SettingsRow>}
      {storage?.backupPath && <p className="px-4 pb-3 text-xs text-muted-foreground break-all">{t('settings.freeStorage.backup')}: {storage.backupPath}</p>}
      {(error || storage?.error) && <p role="alert" className="px-4 pb-3 text-sm text-destructive">{error || storage?.error}</p>}
    </SettingsCard>
  </SettingsSection>
}
