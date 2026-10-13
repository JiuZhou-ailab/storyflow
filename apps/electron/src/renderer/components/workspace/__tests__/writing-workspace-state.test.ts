// input: Real extracted file-operation callbacks, controlled catalog state, and mocked native IO
// output: Regression checks for file creation/import, rename/move, deletion, and tree expansion
// pos: Tests useWritingWorkspaceState without loading desktop providers or a Chromium process
import { expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as model from '../workspace-file-tree-model'
import * as tabs from '@/lib/writing-workspace'

const source = readFileSync(new URL('../useWritingWorkspaceState.ts', import.meta.url), 'utf8')
function handlers(context: Record<string, unknown>) {
  const file = ts.createSourceFile('hook.ts', source, ts.ScriptTarget.Latest, true)
  const parts: string[] = []
  file.forEachChild(node => {
    if (!ts.isFunctionDeclaration(node)) return
    if (node.name?.text !== 'useWritingWorkspaceState') parts.push(node.getText(file))
    else node.body?.forEachChild(statement => {
      if (!ts.isVariableStatement(statement)) return
      const declaration = statement.declarationList.declarations[0]!
      if (ts.isIdentifier(declaration.name) && /^(handle|openWorkspace|expandWorkspace)/.test(declaration.name.text)) parts.push(statement.getText(file))
    })
  })
  const js = ts.transpileModule(parts.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(context), `${js}; return { openWorkspaceCreateEntryDialog, handleSubmitWorkspaceCreateEntry, handleImportNovelFiles, handleMoveNovelWorkspaceEntry, handleRenameNovelWorkspaceEntry, handleDeleteNovelWorkspaceEntry, handleWorkspaceTreeExpandedChange }`)(...Object.values(context))
}
const file = (path: string) => ({ path: `/root/${path}`, relativePath: path })
const node = (path: string, type: 'file' | 'directory' = 'file') => ({ ...file(path), id: path, name: path.split('/').at(-1)!, type, fileCount: 0 })
function harness() {
  const state = { files: [file('a.md')], directories: ['folder'], expanded: new Set(['writing:folder:folder']), tabs: { workspaceRoot: '/root', paths: ['/root/a.md'], activePath: '/root/a.md' }, target: null as any, value: '', busy: false }
  const updates: string[] = []
  const set = (key: keyof typeof state) => (value: any) => { (state as any)[key] = typeof value === 'function' ? value(state[key]) : value }
  const error = mock(), success = mock()
  const api = {
    createDirectory: mock(async (_path: string) => { updates.push('mkdir') }),
    writeFile: mock(async (_path: string, _content: string) => { updates.push('write') }),
    openFileDialog: mock(async () => ['/import/b.md']),
    readUserAttachment: mock(async () => ({ text: 'imported' })),
    moveWorkspaceEntry: mock(async () => ({ sourcePath: '/root/a.md', destinationPath: '/root/b.md' })),
    deleteWorkspaceEntry: mock(async () => {}),
  }
  const context: Record<string, any> = {
    ...model, ...tabs, React: { useCallback: (fn: unknown) => fn },
    activeWorkspaceId: 'project', novelWorkspaceRoot: '/root', novelWorkspaceFiles: state.files,
    novelWorkspaceDirectories: state.directories, expandedFolders: state.expanded, selectedNovelFilePath: '/root/a.md',
    setNovelWorkspaceFiles: set('files'), setNovelWorkspaceDirectories: set('directories'), setExpandedFolders: set('expanded'), setNovelDocumentTabs: set('tabs'),
    workspaceCreateEntryTarget: { kind: 'file', parentRelativePath: 'folder' }, workspaceCreateEntryValue: 'b.md',
    setWorkspaceCreateEntryTarget: set('target'), setWorkspaceCreateEntryValue: set('value'), setWorkspaceCreatingEntry: set('busy'),
    ensureNovelDocumentSavedRef: { current: mock(async () => true) }, isCurrentNovelDocumentDirty: () => false,
    invalidateNovelWorkspaceCatalogRequests: mock(() => {}), refreshNovelWorkspaceFilesAfterMutation: mock(async () => { updates.push('refresh'); return true }),
    workspaceFileTreeRef: { current: { open: mock() } }, requestAnimationFrame: (fn: () => void) => fn(),
    window: { electronAPI: api, confirm: () => true }, toast: { error, success },
    navigate: mock(), routes: { view: { writing: () => 'writing' } }, t: (key: string) => key,
    console: { error() {} },
  }
  return { context, state, api, error, success, updates, get actions() { return handlers(context) } }
}
it('creates a file only after saving and refreshes before selecting it', async () => {
  const h = harness(); await h.actions.handleSubmitWorkspaceCreateEntry()
  expect(h.updates).toEqual(['mkdir', 'write', 'refresh'])
  expect(h.api.writeFile.mock.calls).toEqual([['/root/folder/b.md', '# b\n\n']])
  expect(h.state.tabs.activePath).toBe('/root/folder/b.md')
  expect(h.state.busy).toBe(false)
  expect(h.state.target).toBeNull()
})
it('rejects invalid/colliding names without IO', async () => {
  const h = harness(); h.context.workspaceCreateEntryValue = '../bad.md'
  await h.actions.handleSubmitWorkspaceCreateEntry()
  h.context.workspaceCreateEntryTarget.parentRelativePath = ''; h.context.workspaceCreateEntryValue = 'A.md'
  await h.actions.handleSubmitWorkspaceCreateEntry()
  expect(h.api.writeFile).not.toHaveBeenCalled()
  expect(h.error).toHaveBeenCalledTimes(2)
})
it('a cancelled save prevents creation while folders do not require a save', async () => {
  const h = harness(); h.context.ensureNovelDocumentSavedRef.current = async () => false
  await h.actions.handleSubmitWorkspaceCreateEntry()
  expect(h.api.createDirectory).not.toHaveBeenCalled()
  h.context.workspaceCreateEntryTarget.kind = 'directory'
  await h.actions.handleSubmitWorkspaceCreateEntry()
  expect(h.api.createDirectory).toHaveBeenCalledTimes(1)
  expect(h.api.writeFile).not.toHaveBeenCalled()
  expect(h.state.tabs.activePath).toBe('/root/a.md')
})
it('failed creation preserves the dialog draft and clears busy', async () => {
  const h = harness(); h.state.target = h.context.workspaceCreateEntryTarget
  h.api.writeFile.mockRejectedValueOnce(new Error('disk full'))
  await h.actions.handleSubmitWorkspaceCreateEntry()
  expect(h.state.target).not.toBeNull()
  expect(h.state.busy).toBe(false)
  expect(h.error).toHaveBeenCalled()
  expect(h.context.refreshNovelWorkspaceFilesAfterMutation).not.toHaveBeenCalled()
})
it('imports text through the authorized attachment API then selects the last file', async () => {
  const h = harness(); await h.actions.handleImportNovelFiles('folder')
  expect(h.api.readUserAttachment).toHaveBeenCalledTimes(1)
  expect(h.api.writeFile.mock.calls).toEqual([['/root/folder/b.md', 'imported']])
  expect(h.state.tabs.activePath).toBe('/root/folder/b.md')
})
it('renames using the parent directory and remaps open tabs after confirmed IO', async () => {
  const h = harness(); await h.actions.handleRenameNovelWorkspaceEntry(node('a.md'), 'b.md')
  expect(h.state.files).toEqual([file('b.md')])
  expect(h.state.tabs.activePath).toBe('/root/b.md')
  expect(h.context.invalidateNovelWorkspaceCatalogRequests).toHaveBeenCalledTimes(1)
})
it('dirty documents block moves and deletions', async () => {
  const h = harness(); h.context.isCurrentNovelDocumentDirty = () => true
  await h.actions.handleRenameNovelWorkspaceEntry(node('a.md'), 'b.md')
  await h.actions.handleDeleteNovelWorkspaceEntry(node('a.md'))
  expect(h.api.moveWorkspaceEntry).not.toHaveBeenCalled()
  expect(h.api.deleteWorkspaceEntry).not.toHaveBeenCalled()
})
it('deletion updates catalog and tabs only after confirmation and successful IO', async () => {
  const h = harness(); h.context.window.confirm = () => false
  await h.actions.handleDeleteNovelWorkspaceEntry(node('a.md'))
  expect(h.api.deleteWorkspaceEntry).not.toHaveBeenCalled()
  h.context.window.confirm = () => true
  h.api.deleteWorkspaceEntry.mockRejectedValueOnce(new Error('denied'))
  await h.actions.handleDeleteNovelWorkspaceEntry(node('a.md'))
  expect(h.state.files).toEqual([file('a.md')])
  await h.actions.handleDeleteNovelWorkspaceEntry(node('a.md'))
  expect(h.state.files).toEqual([])
  expect(h.state.tabs.paths).toEqual([])
})
it('expansion updates are idempotent and new dialogs clear prior drafts', () => {
  const h = harness(), original = h.state.expanded
  h.actions.handleWorkspaceTreeExpandedChange('writing:folder:folder', true)
  expect(h.state.expanded).toBe(original)
  h.actions.handleWorkspaceTreeExpandedChange('writing:folder:folder', false)
  expect(h.state.expanded.size).toBe(0)
  h.state.value = 'old'; h.actions.openWorkspaceCreateEntryDialog({ kind: 'file', parentRelativePath: '' })
  expect(h.state.value).toBe('')
  expect(h.state.target.kind).toBe('file')
})
