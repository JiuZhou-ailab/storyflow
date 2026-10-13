// input: Runtime-owned file identity, watcher refresh hint and optional Search Hit
// output: Shared document bar (status, conflict choice), autosave and the original-text view
// pos: Text file views using the shared renderer document lifecycle and versioned RPC
import { useCallback, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { DocumentSearchTarget } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import { TextSource } from './TextSource'
import { documentModel, dirtyDocument, keepDraft, releaseDocument, retainDocument, reloadDocument, saveDocument, updateDocument, type DocumentModel, type DocumentState } from './text-document-state'

export function useDocumentState(model: DocumentModel): DocumentState {
  const subscribe = useMemo(() => (listener: () => void) => {
    retainDocument(model)
    model.listeners.add(listener)
    return () => { model.listeners.delete(listener); releaseDocument(model) }
  }, [model])
  return useSyncExternalStore(subscribe, () => model.state)
}

export const saveDocumentFromView = (model: DocumentModel) => { model.flush?.(); return saveDocument(model) }

const AUTOSAVE_DELAY_MS = 800

/** Saves a changed draft once typing pauses; a conflict waits for the user's choice. */
export function useDocumentAutosave(state: DocumentState | null, save: () => Promise<unknown>) {
  useEffect(() => {
    if (!state || state.loading || state.readOnly || state.saving || state.conflict) return
    if (state.content === state.baseline) return
    const timeoutId = window.setTimeout(() => { void save() }, AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(timeoutId)
  }, [save, state])
}

const barButton = 'inline-flex h-6 items-center rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:pointer-events-none disabled:opacity-40'

/** One bar per document: every view of the file shares its status and conflict choice. */
export function TextDocumentBar({ model, state, leading, trailing }: {
  model: DocumentModel; state: DocumentState; leading?: ReactNode; trailing?: ReactNode
}) {
  const { t } = useTranslation()
  const error = state.error === 'conflict' || state.error === 'missing' || state.error === 'readOnly' ? t(`textDocument.${state.error}`) : state.error
  const dirty = dirtyDocument(model)
  const status = state.saving ? 'saving' : state.readOnly ? 'readOnly' : dirty ? 'unsaved' : 'saved'
  return <>
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-foreground/[0.06] px-3 text-xs">
      {leading}
      <span role="status" className={cn('mr-auto shrink-0 pl-2', dirty || state.conflict ? 'text-foreground/70' : 'text-muted-foreground')}>{t(`textDocument.${status}`)}</span>
      {trailing}
    </div>
    {error && <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-destructive/20 bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
      <span className="mr-auto">{error}</span>
      {state.conflict && <>
        <button type="button" className={barButton} disabled={state.saving} onClick={() => { model.flush?.(); void keepDraft(model) }}>{t('textDocument.keepDraft')}</button>
        <button type="button" className={barButton} disabled={state.saving} onClick={() => {
          if (window.confirm(t('textDocument.discardQuestion'))) {
            updateDocument(model, { content: state.baseline }); void reloadDocument(model)
          }
        }}>{t('textDocument.reload')}</button>
      </>}
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

export function TextDocument({ path, workspaceId, sessionId, refresh, searchTarget }: {
  path: string; workspaceId: string; sessionId?: string; refresh?: string | number; searchTarget?: DocumentSearchTarget
}) {
  const model = useMemo(() => documentModel(workspaceId, { path, sessionId }), [workspaceId, path, sessionId])
  const state = useDocumentState(model)
  const save = useCallback(() => saveDocumentFromView(model), [model])
  useEffect(() => { model.autosave = true }, [model])
  useEffect(() => { void reloadDocument(model) }, [model, refresh])
  useDocumentAutosave(state, save)
  return <div className="flex h-full min-h-0 flex-col" data-testid="text-document" onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save() }
  }}>
    <TextDocumentBar model={model} state={state} />
    <TextDocumentSource model={model} state={state} searchTarget={searchTarget} />
  </div>
}
