// input: Runtime-scoped file identities, user edits and file RPC results
// output: Stable drafts, versioned save state and a shared leave decision
// pos: Renderer-owned text document lifecycle across view remounts
import type { TextDocumentTarget, TextDocumentSnapshot } from '@craft-agent/shared/protocol'

export interface DocumentState {
  content: string
  baseline: string
  version: string
  loading: boolean
  readOnly: boolean
  saving: boolean
  error: string | null
  conflict: boolean
}
export interface DocumentModel {
  key: string
  workspaceId: string
  format?: { bom: boolean; crlf: boolean }
  target: TextDocumentTarget
  state: DocumentState
  listeners: Set<() => void>
  generation: number
  savePromise?: Promise<boolean>
}
const documents = new Map<string, DocumentModel>()
export const dirtyDocument = (model: DocumentModel) => model.state.content !== model.state.baseline
export function documentModel(workspaceId: string, target: TextDocumentTarget): DocumentModel {
  const key = JSON.stringify([workspaceId, target.sessionId, target.path])
  let model = documents.get(key)
  if (!model) {
    model = { key, workspaceId, target, listeners: new Set(), generation: 0, state: { content: '', baseline: '', version: '', loading: true, readOnly: true, saving: false, error: null, conflict: false } }
    documents.set(key, model)
  }
  return model
}
export function retainDocument(model: DocumentModel) { documents.set(model.key, model) }
export function releaseDocument(model: DocumentModel) {
  // Dirty drafts survive responsive/unexpected view replacement and remain in the leave gate.
  if (!model.listeners.size && !dirtyDocument(model) && !model.state.saving) {
    for (const [key, candidate] of documents) if (candidate === model) documents.delete(key)
  }
}
export function updateDocument(model: DocumentModel, change: Partial<DocumentState>) {
  if (change.content !== undefined && change.content !== model.state.content) model.generation += 1
  model.state = { ...model.state, ...change }
  for (const listener of model.listeners) listener()
}
export async function reloadDocument(model: DocumentModel) {
  if (model.state.saving) return
  const generation = ++model.generation
  try {
    const result: TextDocumentSnapshot = await window.electronAPI.readTextDocument(model.target)
    if (generation !== model.generation) return
    if (dirtyDocument(model)) {
      if (result.version !== model.state.version) updateDocument(model, { conflict: true, error: 'conflict' })
      return
    }
    model.format = result.format
    updateDocument(model, { content: result.content, baseline: result.content, version: result.version, readOnly: result.readOnly, loading: false, error: result.reason ?? null, conflict: false })
  } catch (error) {
    if (generation === model.generation) updateDocument(model, { loading: false, readOnly: dirtyDocument(model) ? model.state.readOnly : true, error: String(error).includes('ENOENT') ? 'missing' : String(error) })
  }
}
export async function saveDocument(model: DocumentModel, destination?: string): Promise<boolean> {
  if (model.savePromise) { await model.savePromise; return saveDocument(model, destination) }
  if (!dirtyDocument(model) && !destination) return true
  if (model.state.loading || model.state.readOnly) return false
  model.generation += 1
  const content = model.state.content
  const version = model.state.version
  updateDocument(model, { saving: true, error: null })
  const task = (async () => {
    try {
      const result = await window.electronAPI.saveTextDocument({ ...model.target, version, content, destination, format: model.format })
      if (result.status !== 'saved') {
        updateDocument(model, { conflict: true, error: result.status })
        return false
      }
      if (destination) {
        documents.delete(model.key)
        model.target = { ...model.target, path: result.path }
        model.key = JSON.stringify([model.workspaceId, model.target.sessionId, result.path])
        documents.set(model.key, model)
      }
      updateDocument(model, { baseline: content, version: result.version, conflict: false })
      return true
    } catch (error) { updateDocument(model, { error: String(error) }); return false }
    finally { updateDocument(model, { saving: false }); model.savePromise = undefined }
  })()
  model.savePromise = task
  return task
}

let leavePromise: Promise<boolean> | undefined
let prompt: DocumentModel | null = null
let answer: ((value: 'save' | 'discard' | 'cancel') => void) | undefined
const promptListeners = new Set<() => void>()
export const subscribeLeavePrompt = (listener: () => void) => { promptListeners.add(listener); return () => { promptListeners.delete(listener) } }
export const getLeavePrompt = () => prompt
export const answerLeavePrompt = (value: 'save' | 'discard' | 'cancel') => answer?.(value)
export function requestDocumentLeave(): Promise<boolean> {
  if (leavePromise) return leavePromise
  leavePromise = (async () => {
    for (const model of documents.values()) {
      if (model.savePromise) await model.savePromise
      if (!dirtyDocument(model)) continue
      const choice = await new Promise<'save' | 'discard' | 'cancel'>(resolve => {
        answer = resolve; prompt = model
        for (const listener of promptListeners) listener()
      })
      prompt = null; answer = undefined
      for (const listener of promptListeners) listener()
      if (choice === 'cancel') return false
      if (choice === 'save' && (!await saveDocument(model) || dirtyDocument(model))) return false
      if (choice === 'discard') {
        updateDocument(model, { content: model.state.baseline })
        void reloadDocument(model)
      }
      releaseDocument(model)
    }
    return true
  })().finally(() => { leavePromise = undefined })
  return leavePromise
}
export const hasDirtyDocuments = () => [...documents.values()].some(model => dirtyDocument(model) || model.state.saving)
