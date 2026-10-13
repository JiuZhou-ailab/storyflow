// input: Runtime-owned file identity, watcher refresh hint and optional Search Hit
// output: Shared document bar (status, save, conflicts, recovery) and the original-text view
// pos: Text file views using the shared renderer document lifecycle and versioned RPC
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { DocumentSearchTarget } from '@craft-agent/ui'
import type { TextDocumentRecovery } from '@craft-agent/shared/protocol'
import { cn } from '@/lib/utils'
import { TextSource } from './TextSource'
import { documentModel, dirtyDocument, releaseDocument, retainDocument, reloadDocument, saveDocument, updateDocument, type DocumentModel, type DocumentState } from './text-document-state'

export function useDocumentState(model: DocumentModel): DocumentState {
  const subscribe = useMemo(() => (listener: () => void) => {
    retainDocument(model)
    model.listeners.add(listener)
    return () => { model.listeners.delete(listener); releaseDocument(model) }
  }, [model])
  return useSyncExternalStore(subscribe, () => model.state)
}

export const saveDocumentFromView = (model: DocumentModel) => { model.flush?.(); return saveDocument(model) }

const barButton = 'inline-flex h-6 items-center rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:pointer-events-none disabled:opacity-40'

/** One bar per document: every view of the file shares its status, save and recovery. */
export function TextDocumentBar({ model, state, leading, trailing, onOpenSavedFile }: {
  model: DocumentModel; state: DocumentState; leading?: ReactNode; trailing?: ReactNode
  onOpenSavedFile: (path: string) => void
}) {
  const { t } = useTranslation()
  const [destination, setDestination] = useState<string | null>(null)
  const [recoveries, setRecoveries] = useState<TextDocumentRecovery[] | null>(null)
  const [recovery, setRecovery] = useState<{ before: string; submitted: string } | null>(null)
  const save = () => { void saveDocumentFromView(model) }
  const error = state.error === 'conflict' || state.error === 'missing' ? t(`textDocument.${state.error}`) : state.error
  const dirty = dirtyDocument(model)
  const status = state.saving ? 'saving' : state.readOnly ? 'readOnly' : dirty ? 'unsaved' : 'saved'
  return <>
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-foreground/[0.06] px-3 text-xs">
      {leading}
      <span role="status" className={cn('mr-auto shrink-0 pl-2', dirty || state.conflict ? 'text-foreground/70' : 'text-muted-foreground')}>{t(`textDocument.${status}`)}</span>
      <button type="button" className={barButton} disabled={state.readOnly || state.saving || !dirty} onClick={save}>{t('textDocument.save')}</button>
      {!state.readOnly && <button type="button" className={barButton} onClick={() => { setDestination(model.target.path.replace(/(\.[^./\\]+)$/, '-copy$1')) }}>{t('textDocument.saveAs')}</button>}
      <button type="button" className={barButton} onClick={() => { void window.electronAPI.listTextDocumentRecovery(model.target).then(setRecoveries).catch(error => updateDocument(model, { error: String(error) })) }}>{t('textDocument.recovery')}</button>
      {trailing}
    </div>
    {error && <div role="alert" className="shrink-0 border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</div>}
    {state.conflict && <button type="button" className={cn(barButton, 'mx-3 my-1 self-start')} onClick={() => {
      if (window.confirm(t('textDocument.discardQuestion'))) {
        updateDocument(model, { content: state.baseline }); void reloadDocument(model)
      }
    }}>{t('textDocument.reload')}</button>}
    {destination !== null && <form className="flex gap-2 p-2 text-xs" onSubmit={event => {
      event.preventDefault()
      model.flush?.()
      void saveDocument(model, destination).then(ok => { if (ok) { setDestination(null); onOpenSavedFile(model.target.path) } })
    }}>
      <input aria-label={t('textDocument.destination')} className="min-w-0 flex-1 border bg-transparent" value={destination} onChange={event => setDestination(event.target.value)} />
      <button type="submit" className={barButton} disabled={state.saving || state.readOnly}>{t('textDocument.saveAs')}</button>
      <button type="button" className={barButton} onClick={() => setDestination(null)}>{t('common.cancel')}</button>
    </form>}
    {recoveries !== null && <div className="max-h-40 shrink-0 overflow-auto border-b p-2 text-xs">
      <button type="button" className={barButton} onClick={() => { setRecoveries(null); setRecovery(null) }}>{t('common.close')}</button>
      {recoveries.length === 0 && <span>{t('textDocument.noRecovery')}</span>}
      {recoveries.map(record => <button className="block" key={record.id} type="button" onClick={() => {
        void window.electronAPI.readTextDocumentRecovery({ ...model.target, id: record.id }).then(setRecovery).catch(error => updateDocument(model, { error: String(error) }))
      }}>{new Date(record.createdAt).toLocaleString()}</button>)}
      {recovery && <><label>{t('textDocument.before')}<textarea readOnly className="block w-full bg-transparent" value={recovery.before} /></label><label>{t('textDocument.submitted')}<textarea readOnly className="block w-full bg-transparent" value={recovery.submitted} /></label></>}
    </div>}
  </>
}

/** Original-text view of a document; the bar is supplied by the host when it owns one. */
export function TextDocumentSource({ model, state, searchTarget }: { model: DocumentModel; state: DocumentState; searchTarget?: DocumentSearchTarget }) {
  const { t } = useTranslation()
  return state.loading
    ? <div role="status">{t('fileViewer.loadingContent')}</div>
    : <TextSource label={model.target.path} content={state.content} searchTarget={searchTarget} onChange={state.readOnly ? undefined : content => updateDocument(model, { content })} />
}

export function TextDocument({ path, workspaceId, sessionId, refresh, searchTarget, onOpenSavedFile }: {
  onOpenSavedFile: (path: string) => void
  path: string; workspaceId: string; sessionId?: string; refresh?: string | number; searchTarget?: DocumentSearchTarget
}) {
  const model = useMemo(() => documentModel(workspaceId, { path, sessionId }), [workspaceId, path, sessionId])
  const state = useDocumentState(model)
  useEffect(() => { void reloadDocument(model) }, [model, refresh])
  return <div className="flex h-full min-h-0 flex-col" data-testid="text-document" onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void saveDocumentFromView(model) }
  }}>
    <TextDocumentBar model={model} state={state} onOpenSavedFile={onOpenSavedFile} />
    <TextDocumentSource model={model} state={state} searchTarget={searchTarget} />
  </div>
}
