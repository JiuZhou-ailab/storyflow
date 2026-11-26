// input: Project workspace id, the selected text file, its active view, a refresh hint and the rich-text editor handle
// output: The file's shared versioned draft plus flush, save, reload and editor-change handling for either view
// pos: Project document lifecycle — one draft per file (text-document-state), whichever view renders it

import * as React from 'react'
import { classifyFile } from '@craft-agent/ui/file-classification'
import {
  dirtyDocument,
  documentModel,
  flushDocument,
  releaseDocument,
  reloadDocument,
  retainDocument,
  saveDocument,
  updateDocument,
  type DocumentModel,
  type DocumentState,
} from '@/components/files/text-document-state'
import { useDocumentAutosave } from '@/components/files/TextDocument'
import type { NovelDocumentEditorPanelHandle } from './NovelDocumentEditorPanel'

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
  editorRef: React.RefObject<NovelDocumentEditorPanelHandle | null>
  snapshotBlockedMessage: string
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
  snapshotBlockedMessage,
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

  const callbacksRef = React.useRef({ onLoaded, onBeforeSave, onSaved, snapshotBlockedMessage })
  callbacksRef.current = { onLoaded, onBeforeSave, onSaved, snapshotBlockedMessage }

  // Serializing the rich-text document is costly, so edits are pulled into the
  // draft on idle and before anything reads it (save, leave, view switch).
  const flushTimerRef = React.useRef<number | null>(null)
  const flush = React.useCallback(() => {
    const current = modelRef.current
    return !current || flushDocument(current)
  }, [])

  const clearFlushTimer = React.useCallback(() => {
    if (flushTimerRef.current != null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
  }, [])

  const handleEditorChanged = React.useCallback(() => {
    const current = modelRef.current
    if (!current) return
    // A disk read started before this keystroke must not replace the buffer.
    current.generation += 1
    const editor = editorRef.current
    current.flush = () => {
      const snapshot = modelRef.current === current && editor === editorRef.current
        ? editor?.getMarkdownSnapshot() ?? null
        : null
      const message = callbacksRef.current.snapshotBlockedMessage
      if (snapshot === null) {
        if (current.state.snapshotError !== message) updateDocument(current, { snapshotError: message })
        return false
      }

      current.flush = undefined
      if (snapshot !== current.state.content || current.state.snapshotError) {
        updateDocument(current, { content: snapshot, snapshotError: undefined })
      }
      return true
    }
    clearFlushTimer()
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null
      flushDocument(current)
    }, EDITOR_FLUSH_DELAY_MS)
  }, [clearFlushTimer, editorRef])

  React.useEffect(() => {
    if (model) model.autosave = true
    return clearFlushTimer
  }, [clearFlushTimer, model, view])

  const isDirty = React.useCallback(() => {
    if (!flush()) return true
    const current = modelRef.current
    return !!current && dirtyDocument(current)
  }, [flush])

  const save = React.useCallback(async (): Promise<boolean> => {
    if (!flush()) return false
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
    await reloadDocument(current)
  }, [])

  React.useEffect(() => {
    if (!model) return
    const startedAt = performance.now()
    void reloadDocument(model).then(() => {
      if (modelRef.current !== model || model.state.loading) return
      callbacksRef.current.onLoaded?.(model.target.path, model.state.content, performance.now() - startedAt)
    })
  }, [model, refresh])

  useDocumentAutosave(state, save)

  return { model: model as DocumentModel | null, state, flush, isDirty, save, reload, handleEditorChanged }
}
