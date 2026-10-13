import { expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { mapNativeWorkspaceCatalog } from '@/lib/writing-workspace'

const source = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf8')
const file = ts.createSourceFile('AppShell.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const loader = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'loadNovelWorkspaceFileTree')!
const js = ts.transpileModule(loader.getText(file), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
function load(result: unknown) {
  return new Function('window', 'mapNativeWorkspaceCatalog', `${js}; return loadNovelWorkspaceFileTree('/root')`)(
    { electronAPI: { listWorkspaceFiles: async (_root: string, _roots: string[], options: unknown) => {
      expect(options).toEqual({ includeMetadata: true })
      return result
    } } }, mapNativeWorkspaceCatalog,
  )
}
const entries = [{ name: 'a.md', type: 'file', path: '/root/a.md', relativePath: 'a.md' }]
it('carries the RPC truncation fact into the renderer catalog', async () => {
  const result = await load({ entries, truncated: true })
  expect(result.files[0].relativePath).toBe('a.md')
  expect(result.truncated).toBe(true)
})
it('accepts legacy servers and optional missing metadata', async () => {
  expect((await load(entries)).files).toHaveLength(1)
  expect((await load(entries)).truncated).toBeUndefined()
  expect((await load({ entries })).truncated).toBeUndefined()
})
