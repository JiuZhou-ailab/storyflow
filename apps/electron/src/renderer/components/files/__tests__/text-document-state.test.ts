import { afterEach, describe, expect, it, mock } from 'bun:test'
import {
  documentModel,
  dirtyDocument,
  getLeavePrompt,
  hasDirtyDocuments,
  reloadDocument,
  requestDocumentLeave,
  saveDocument,
  updateDocument,
} from '../text-document-state'

const originalWindow = globalThis.window
let disk: { content: string; version: string }
let seq = 0

function installApi(overrides: Record<string, unknown> = {}) {
  const saveTextDocument = mock(async (request: { version: string; content: string; path: string }) => {
    if (request.version !== disk.version) return { status: 'conflict' }
    disk = { content: request.content, version: `v${++seq}` }
    return { status: 'saved', version: disk.version, path: request.path }
  })
  globalThis.window = {
    electronAPI: {
      readTextDocument: mock(async () => ({ content: disk.content, version: disk.version, readOnly: false, format: { bom: false, crlf: false } })),
      saveTextDocument,
      ...overrides,
    },
  } as unknown as Window & typeof globalThis
  return { saveTextDocument }
}

async function loadedModel(path: string) {
  const model = documentModel('ws', { path })
  await reloadDocument(model)
  return model
}

afterEach(async () => {
  globalThis.window = originalWindow
})

describe('text document lifecycle', () => {
  it('saves an autosave document silently when leaving', async () => {
    disk = { content: 'a', version: 'v0' }
    const { saveTextDocument } = installApi()
    const model = await loadedModel('/p/autosave.md')
    model.autosave = true
    updateDocument(model, { content: 'ab' })

    expect(await requestDocumentLeave()).toBe(true)
    expect(getLeavePrompt()).toBeNull()
    expect(saveTextDocument).toHaveBeenCalledTimes(1)
    expect(disk.content).toBe('ab')
    expect(dirtyDocument(model)).toBe(false)
  })

  it('keeps the buffer and never overwrites when disk changed under it', async () => {
    disk = { content: 'a', version: 'v0' }
    installApi()
    const model = await loadedModel('/p/conflict.md')
    updateDocument(model, { content: 'mine' })
    disk = { content: 'agent', version: 'v-agent' }

    expect(await saveDocument(model)).toBe(false)
    expect(disk.content).toBe('agent')
    expect(model.state.content).toBe('mine')
    expect(model.state.conflict).toBe(true)
    updateDocument(model, { content: model.state.baseline })
  })

  it('flushes view-held edits before reporting dirtiness', async () => {
    disk = { content: 'a', version: 'v0' }
    installApi()
    const model = await loadedModel('/p/flush.md')
    model.flush = () => updateDocument(model, { content: 'typed' })

    expect(hasDirtyDocuments()).toBe(true)
    expect(model.state.content).toBe('typed')
    model.flush = undefined
    updateDocument(model, { content: model.state.baseline })
  })
})
