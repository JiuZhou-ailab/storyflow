// input: Pending document leave decision and native unload requests
// output: One accessible save/discard/cancel gate across the renderer
// pos: Application-level host for file-owned unsaved decisions
import { useEffect, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog'
import { answerLeavePrompt, getLeavePrompt, subscribeLeavePrompt, hasDirtyDocuments, requestDocumentLeave } from './text-document-state'

export function DocumentLeaveDialog() {
  const { t } = useTranslation()
  const model = useSyncExternalStore(subscribeLeavePrompt, getLeavePrompt)
  useEffect(() => {
    const host = window as unknown as { requestDocumentLeave?: () => Promise<boolean> }
    host.requestDocumentLeave = requestDocumentLeave
    const unload = (event: BeforeUnloadEvent) => { if (hasDirtyDocuments()) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', unload)
    return () => { delete host.requestDocumentLeave; window.removeEventListener('beforeunload', unload) }
  }, [])
  return <Dialog open={!!model} onOpenChange={open => { if (!open) answerLeavePrompt('cancel') }}>
    <DialogContent><DialogHeader><DialogTitle>{t('textDocument.unsaved')}</DialogTitle><DialogDescription>{model?.target.path}</DialogDescription></DialogHeader>
      <div className="flex justify-end gap-4">
        <button type="button" onClick={() => answerLeavePrompt('cancel')}>{t('common.cancel')}</button>
        <button type="button" onClick={() => answerLeavePrompt('discard')}>{t('textDocument.discard')}</button>
        <button type="button" onClick={() => answerLeavePrompt('save')}>{t(model?.state.conflict ? 'textDocument.keepDraft' : 'textDocument.save')}</button>
      </div>
    </DialogContent>
  </Dialog>
}
