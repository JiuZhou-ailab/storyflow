// input: Runtime-owned file identity, watcher refresh hint and optional Search Hit
// output: Editable original text, explicit save, conflict handling and recovery access
// pos: Text file view using the shared renderer document lifecycle and versioned RPC
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import type { DocumentSearchTarget } from '@craft-agent/ui'
import type { TextDocumentRecovery } from '@craft-agent/shared/protocol'
import { TextSource } from './TextSource'
import { documentModel, dirtyDocument, releaseDocument, retainDocument, reloadDocument, saveDocument, updateDocument } from './text-document-state'

export function TextDocument({ path, workspaceId, sessionId, refresh, searchTarget, onOpenSavedFile }: {
  onOpenSavedFile: (path: string) => void
  path: string; workspaceId: string; sessionId?: string; refresh?: string | number; searchTarget?: DocumentSearchTarget
}) {
  const { t } = useTranslation()
  const model = useMemo(() => documentModel(workspaceId, { path, sessionId }), [workspaceId, path, sessionId])
  const subscribe = useMemo(() => (listener: () => void) => {
    retainDocument(model)
    model.listeners.add(listener)
    return () => { model.listeners.delete(listener); releaseDocument(model) }
  }, [model])
  const state = useSyncExternalStore(subscribe, () => model.state)
  const [destination, setDestination] = useState<string | null>(null)
  const [recoveries, setRecoveries] = useState<TextDocumentRecovery[] | null>(null)
  const [recovery, setRecovery] = useState<{ before: string; submitted: string } | null>(null)
  useEffect(() => { void reloadDocument(model) }, [model, refresh])
  const save = () => { void saveDocument(model) }
  const error = state.error === 'conflict' || state.error === 'missing' ? t(`textDocument.${state.error}`) : state.error
  const status = state.saving ? 'saving' : state.readOnly ? 'readOnly' : dirtyDocument(model) ? 'unsaved' : 'saved'
  return <div className="flex h-full min-h-0 flex-col" data-testid="text-document" onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save() }
  }}>
    <div className="flex shrink-0 items-center gap-3 border-b border-border/40 px-3 py-1 text-xs">
      <span role="status" className="mr-auto text-muted-foreground">{t(`textDocument.${status}`)}</span>
      <button type="button" disabled={state.readOnly || state.saving || !dirtyDocument(model)} onClick={save}>{t('textDocument.save')}</button>
      {!state.readOnly && <button type="button" onClick={() => { setDestination(path.replace(/(\.[^./\\]+)$/, '-copy$1')) }}>{t('textDocument.saveAs')}</button>}
      <button type="button" onClick={() => { void window.electronAPI.listTextDocumentRecovery(model.target).then(setRecoveries).catch(error => updateDocument(model, { error: String(error) })) }}>{t('textDocument.recovery')}</button>
    </div>
    {error && <div role="alert" className="shrink-0 p-2 text-xs text-destructive">{error}</div>}
    {state.conflict && <button type="button" className="p-2 text-xs" onClick={() => {
      if (window.confirm(t('textDocument.discardQuestion'))) {
        updateDocument(model, { content: state.baseline }); void reloadDocument(model)
      }
    }}>{t('textDocument.reload')}</button>}
    {destination !== null && <form className="flex gap-2 p-2 text-xs" onSubmit={event => {
      event.preventDefault(); void saveDocument(model, destination).then(ok => { if (ok) { setDestination(null); onOpenSavedFile(model.target.path) } })
    }}>
      <input aria-label={t('textDocument.destination')} className="min-w-0 flex-1 border bg-transparent" value={destination} onChange={event => setDestination(event.target.value)} />
      <button type="submit" disabled={state.saving || state.readOnly}>{t('textDocument.saveAs')}</button>
      <button type="button" onClick={() => setDestination(null)}>{t('common.cancel')}</button>
    </form>}
    {recoveries !== null && <div className="max-h-40 overflow-auto border-b p-2 text-xs">
      <button type="button" onClick={() => { setRecoveries(null); setRecovery(null) }}>{t('common.close')}</button>
      {recoveries.length === 0 && <span>{t('textDocument.noRecovery')}</span>}
      {recoveries.map(record => <button className="block" key={record.id} type="button" onClick={() => {
        void window.electronAPI.readTextDocumentRecovery({ ...model.target, id: record.id }).then(setRecovery).catch(error => updateDocument(model, { error: String(error) }))
      }}>{new Date(record.createdAt).toLocaleString()}</button>)}
      {recovery && <><label>{t('textDocument.before')}<textarea readOnly className="block w-full bg-transparent" value={recovery.before} /></label><label>{t('textDocument.submitted')}<textarea readOnly className="block w-full bg-transparent" value={recovery.submitted} /></label></>}
    </div>}
    {state.loading ? <div role="status">{t('fileViewer.loadingContent')}</div> : <TextSource label={path} content={state.content} searchTarget={searchTarget} onChange={state.readOnly ? undefined : content => updateDocument(model, { content })} />}
  </div>
}
