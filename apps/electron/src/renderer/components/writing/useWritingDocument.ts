// input: Project workspace id, the selected text file, its active view, a refresh hint and the rich-text editor handle
// output: The file's shared versioned draft plus flush, save, reload and editor-change handling for either view
// pos: Project document lifecycle — one draft per file (text-document-state), whichever view renders it

import * as React from 'react'
import { classifyFile } from '@craft-agent/ui/file-classification'
import {
  dirtyDocument,
  documentModel,
  releaseDocument,
  reloadDocument,
  retainDocument,
  saveDocument,
  updateDocument,
  type DocumentModel,
  type DocumentState,
} from '@/components/files/text-document-state'
import { useDocumentAutosave } from '@/components/files/TextDocument'

export type WritingDocumentView = 'writing' | 'source'

/** Rich text only for Markdown: other text keeps its bytes because it never passes through serialization. */
export function canWriteInRichText(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

export function isTextDocumentPath(path: string): boolean {
  const classification = classifyFile(path)
  return !!classification.canPreview && ['code', 'text', 'markdown', 'json'].includes(classification.type ?? '')
}

const EDITOR_FLUSH_DELAY_MS = 200

export interface UseWritingDocumentOptions {
  workspaceId: string | null
  /** Selected text file, or null when the selection is not a text document. */
  path: string | null
  view: WritingDocumentView
  /** Changes when the file may have changed on disk (watcher mtime, explicit refresh). */
  refresh: string
  editorRef: React.RefObject<{ getMarkdownSnapshot(): string } | null>
  emptySnapshotBlockedMessage: string
  onLoaded?: (path: string, content: string, durationMs: number) => void
  onBeforeSave?: (path: string) => void
  onSaved?: (path: string, content: string) => void
}

const subscribeNothing = () => () => {}
const getNothing = () => null

export function useWritingDocument({
  workspaceId,
  path,
  view,
  refresh,
  editorRef,
  emptySnapshotBlockedMessage,
  onLoaded,
  onBeforeSave,
  onSaved,
}: UseWritingDocumentOptions) {
  const model = React.useMemo(
    () => (workspaceId && path ? documentModel(workspaceId, { path }) : null),
    [workspaceId, path],
  )
  const modelRef = React.useRef(model)
  modelRef.current = model
  const subscribe = React.useMemo(() => {
    if (!model) return subscribeNothing
    return (listener: () => void) => {
      retainDocument(model)
      model.listeners.add(listener)
      return () => { model.listeners.delete(listener); releaseDocument(model) }
    }
  }, [model])
  const state: DocumentState | null = React.useSyncExternalStore(subscribe, model ? () => model.state : getNothing)

  const callbacksRef = React.useRef({ onLoaded, onBeforeSave, onSaved, emptySnapshotBlockedMessage })
  callbacksRef.current = { onLoaded, onBeforeSave, onSaved, emptySnapshotBlockedMessage }

  // Serializing the rich-text document is costly, so edits are pulled into the
  // draft on idle and before anything reads it (save, leave, view switch).
  const pendingEditsRef = React.useRef(false)
  const flushTimerRef = React.useRef<number | null>(null)
  const flush = React.useCallback(() => {
    if (flushTimerRef.current != null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    const current = modelRef.current
    const editor = editorRef.current
    if (!current || !editor || !pendingEditsRef.current) return
    pendingEditsRef.current = false
    const snapshot = editor.getMarkdownSnapshot()
    if (snapshot === current.state.content) return
    // An empty serialization of a non-empty, untouched file is an editor fault, not an edit.
    if (snapshot === '' && current.state.baseline !== '' && current.state.content === current.state.baseline) {
      updateDocument(current, { error: callbacksRef.current.emptySnapshotBlockedMessage })
      return
    }
    updateDocument(current, { content: snapshot })
  }, [editorRef])

  const handleEditorChanged = React.useCallback(() => {
    const current = modelRef.current
    if (!current) return
    pendingEditsRef.current = true
    // A disk read started before this keystroke must not replace the buffer.
    current.generation += 1
    if (flushTimerRef.current != null) window.clearTimeout(flushTimerRef.current)
    flushTimerRef.current = window.setTimeout(flush, EDITOR_FLUSH_DELAY_MS)
  }, [flush])

  React.useEffect(() => {
    if (!model) return
    model.autosave = true
    if (view !== 'writing') return
    model.flush = flush
    return () => {
      flush()
      if (model.flush === flush) model.flush = undefined
    }
  }, [flush, model, view])

  React.useEffect(() => () => {
    if (flushTimerRef.current != null) window.clearTimeout(flushTimerRef.current)
  }, [])

  const isDirty = React.useCallback(() => {
    flush()
    const current = modelRef.current
    return !!current && dirtyDocument(current)
  }, [flush])

  const save = React.useCallback(async (): Promise<boolean> => {
    flush()
    const current = modelRef.current
    if (!current || !dirtyDocument(current)) return true
    const content = current.state.content
    callbacksRef.current.onBeforeSave?.(current.target.path)
    const saved = await saveDocument(current)
    if (saved) callbacksRef.current.onSaved?.(current.target.path, content)
    return saved
  }, [flush])

  const reload = React.useCallback(async () => {
    const current = modelRef.current
    if (!current) return
    flush()
    await reloadDocument(current)
  }, [flush])

  React.useEffect(() => {
    if (!model) return
    flush()
    const startedAt = performance.now()
    void reloadDocument(model).then(() => {
      if (modelRef.current !== model || model.state.loading) return
      callbacksRef.current.onLoaded?.(model.target.path, model.state.content, performance.now() - startedAt)
    })
  }, [flush, model, refresh])

  useDocumentAutosave(state, save)

  return { model: model as DocumentModel | null, state, flush, isDirty, save, reload, handleEditorChanged }
}
