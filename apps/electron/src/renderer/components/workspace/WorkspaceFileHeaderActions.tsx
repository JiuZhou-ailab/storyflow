// input: Selected file path, refresh action, and optional save/read-only constraints
// output: Shared refresh, system-open, and file-location header buttons
// pos: File operations shared by project and conversation workspace headers

import { ExternalLink, FolderOpen, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { HeaderIconButton } from '../ui/HeaderIconButton'
import { getFileManagerName } from '@/lib/platform'

export function WorkspaceFileHeaderActions({ path, onRefresh, readOnly, busy, beforeOpen }: {
  path: string
  onRefresh: () => void
  readOnly?: boolean
  busy?: boolean
  beforeOpen?: () => Promise<boolean>
}) {
  const { t } = useTranslation()
  const open = async () => {
    if (beforeOpen && !await beforeOpen()) return
    try {
      await window.electronAPI.openFile(path)
    } catch (error) {
      toast.error(t('toast.failedToOpenFile'), { description: String(error) })
    }
  }
  const reveal = () => {
    void window.electronAPI.showInFolder(path).catch(error => {
      toast.error(t('toast.failedToReveal', { fileManager: getFileManagerName() }), { description: String(error) })
    })
  }
  return <>
    <HeaderIconButton icon={<RefreshCw className="h-4 w-4" />} tooltip={t('common.retry')} aria-label={t('common.retry')} disabled={busy} onClick={onRefresh} />
    {!readOnly && <HeaderIconButton icon={<ExternalLink className="h-4 w-4" />} tooltip={t('common.open')} aria-label={t('common.open')} disabled={busy} onClick={() => { void open() }} />}
    <HeaderIconButton icon={<FolderOpen className="h-4 w-4" />} tooltip={t('conversationFiles.reveal')} aria-label={t('conversationFiles.reveal')} onClick={reveal} />
  </>
}
