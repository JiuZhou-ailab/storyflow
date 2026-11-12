// input: AppShell's actual async catalog callbacks and controlled RPC completions
// output: Revision, in-flight, failure and cross-Project publication regression coverage
// pos: Executes closure-owned handlers without adding a DOM test dependency
import { expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { normalizeRootPath, getNovelWorkspaceCandidateRoots } from '@/lib/writing-workspace'
import { advanceWorkspaceCatalogRevision, readWorkspaceCatalogRevision } from '../workspace-file-tree-model'

const source = readFileSync(new URL('../../app-shell/AppShell.tsx', import.meta.url), 'utf8')
const file = ts.createSourceFile('AppShell.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function callback(name: string): string {
  let result = ''
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name && node.initializer && ts.isCallExpression(node.initializer)) {
      result = node.initializer.arguments[0].getText(file)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (!result) throw new Error(`Missing production callback: ${name}`)
  return ts.transpileModule(`const fn = ${result}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + '; return fn'
}
function effect(containing: string): string {
  let result = ''
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'React.useLayoutEffect'
      && node.arguments[0]?.getText(file).includes(containing)) result = node.arguments[0].getText(file)
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (!result) throw new Error(`Missing production effect: ${containing}`)
  return ts.transpileModule(`const fn = ${result}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + '; return fn'
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function harness() {
  const ref = <T>(current: T) => ({ current })
  const requests: ReturnType<typeof deferred<any>>[] = []
  const published: any[] = []
  let failure: any = null
  const env: Record<string, any> = {
    novelWorkspaceCatalogCacheRef: ref(new Map()),
    novelWorkspaceLoadInFlightRef: ref(new Map()),
    novelWorkspaceRefreshInFlightRef: ref(new Map()),
    novelWorkspaceCatalogRevisionRef: ref(new Map()),
    novelWorkspaceCandidateRootsRef: ref(['/a']),
    novelWorkspaceRootRef: ref('/a'),
    latestNovelFileChangesSignatureRef: ref('signature-at-start'),
    advanceWorkspaceCatalogRevision, readWorkspaceCatalogRevision, normalizeRootPath,
    loadNovelWorkspaceFileTree: () => { const request = deferred(); requests.push(request); return request.promise },
    setCatalogFailure: (value: any) => { failure = typeof value === 'function' ? value(failure) : value },
    setNovelWorkspaceRoot: (root: string) => published.push({ root }),
    setNovelWorkspaceCatalogIfChanged: (catalog: any) => published.push(catalog),
  }
  for (const name of ['invalidateNovelWorkspaceCatalogRequests', 'loadNovelWorkspaceFiles', 'refreshNovelWorkspaceFiles']) {
    env[name] = new Function(...Object.keys(env), callback(name))(...Object.values(env))
  }
  return { env, requests, published, failure: () => failure,
    runEffect: (containing: string) => new Function(...Object.keys(env), effect(containing))(...Object.values(env))(),
  }
}
const catalog = (path: string) => ({ files: [{ path, relativePath: path }], directories: [] })
it('coalesces warm refreshes and keeps the existing snapshot usable until RPC completes', async () => {
  const { env, requests, published } = harness()
  const previous = catalog('old.md')
  env.novelWorkspaceCatalogCacheRef.current.set('/a', previous)
  const first = env.refreshNovelWorkspaceFiles('/a')
  const second = env.refreshNovelWorkspaceFiles('/a')
  expect(requests).toHaveLength(1)
  expect(env.novelWorkspaceCatalogCacheRef.current.get('/a')).toBe(previous)
  requests[0].resolve(catalog('new.md'))
  expect(await first).toBe(true)
  expect(await second).toBe(true)
  expect(published.at(-1).files[0].path).toBe('new.md')
})
it('never publishes A into first-entry B, including the interval with no mounted root', async () => {
  const { env, requests, published, failure } = harness()
  const pending = env.refreshNovelWorkspaceFiles('/a')
  env.novelWorkspaceCandidateRootsRef.current = ['/b']
  env.novelWorkspaceRootRef.current = null
  requests[0].resolve(catalog('a.md'))
  expect(await pending).toBe(false)
  expect(published).toEqual([])
  expect(failure()).toBeNull()
})
it('A → B → A accepts the current root while the mounted root ref still points to B', async () => {
  const { env, requests, published } = harness()
  env.novelWorkspaceRootRef.current = '/b'
  env.novelWorkspaceCatalogCacheRef.current.set('/a', catalog('previous.md'))
  const pending = env.refreshNovelWorkspaceFiles('/a')
  requests[0].resolve(catalog('a.md'))
  expect(await pending).toBe(true)
  expect(published.at(-1).files[0].path).toBe('a.md')
})
it('invalidation rejects out-of-order results and preserves the newer in-flight request', async () => {
  const { env, requests, published } = harness()
  const old = env.refreshNovelWorkspaceFiles('/a')
  env.invalidateNovelWorkspaceCatalogRequests('/a')
  const latest = env.refreshNovelWorkspaceFiles('/a')
  requests[0].resolve(catalog('stale.md'))
  expect(await old).toBe(false)
  expect(published).toEqual([])
  const duplicate = env.refreshNovelWorkspaceFiles('/a')
  expect(requests).toHaveLength(2)
  requests[1].resolve(catalog('current.md'))
  expect(await latest).toBe(true)
  expect(await duplicate).toBe(true)
  expect(env.novelWorkspaceCatalogCacheRef.current.get('/a').files[0].path).toBe('current.md')
})
it('makes refresh failure retryable without deleting the last snapshot; success clears the error', async () => {
  const { env, requests, published, failure } = harness()
  const previous = catalog('old.md')
  env.novelWorkspaceCatalogCacheRef.current.set('/a', previous)
  const pending = env.refreshNovelWorkspaceFiles('/a')
  requests[0].reject(new Error('EACCES'))
  await expect(pending).rejects.toThrow('EACCES')
  expect(failure()).toEqual({ rootPath: '/a', message: 'EACCES' })
  expect(published).toEqual([])
  expect(env.novelWorkspaceCatalogCacheRef.current.get('/a')).toBe(previous)
  const retry = env.refreshNovelWorkspaceFiles('/a')
  requests[1].resolve(catalog('recovered.md'))
  expect(await retry).toBe(true)
  expect(failure()).toBeNull()
})
it('ignores old-root and invalidated failures', async () => {
  for (const invalidate of [false, true]) {
    const { env, requests, failure } = harness()
    const pending = env.refreshNovelWorkspaceFiles('/a')
    if (invalidate) env.invalidateNovelWorkspaceCatalogRequests('/a')
    else env.novelWorkspaceCandidateRootsRef.current = ['/b']
    requests[0].reject(new Error('old failure'))
    await expect(pending).rejects.toThrow('old failure')
    expect(failure()).toBeNull()
  }
})

it('warm activation publishes its snapshot synchronously and revalidates without clearing an error', async () => {
  const { env, requests, published, failure, runEffect } = harness()
  const previous = catalog('old.md')
  env.novelWorkspaceCatalogCacheRef.current.set('/a', previous)
  env.setCatalogFailure({ rootPath: '/a', message: 'previous failure' })
  const covered: string[] = []
  const frames: Array<() => void> = []
  Object.assign(env, {
    window: { requestAnimationFrame: (callback: () => void) => frames.push(callback) },
    novelWorkspaceCandidateRoots: ['/a'], novelWorkspaceCandidateKey: '/a',
    activeWritingWorkspaceRoot: '/a', rightWorkspaceVisible: true,
    setNovelWorkspaceDetecting: () => {}, setNovelWorkspaceDetectionSettledKey: () => {},
    markNovelWorkspaceFileChangesCovered: (_root: string, signature: string) => covered.push(signature),
  })
  runEffect('async function detectNovelWorkspace')
  expect(published).toEqual([{ root: '/a' }, previous])
  expect(requests).toHaveLength(0)
  frames.shift()!()
  expect(requests).toHaveLength(0)
  frames.shift()!()
  expect(requests).toHaveLength(1)
  expect(failure().message).toBe('previous failure')
  env.latestNovelFileChangesSignatureRef.current = 'later-change'
  requests[0].resolve(catalog('fresh.md'))
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(published.at(-1).files[0].path).toBe('fresh.md')
  expect(failure()).toBeNull()
  expect(covered).toEqual(['signature-at-start'])
})
it('first entry B never borrows A and cancellation prevents late detection publication', async () => {
  const { env, requests, published, runEffect } = harness()
  env.novelWorkspaceCatalogCacheRef.current.set('/a', catalog('a.md'))
  env.novelWorkspaceCandidateRootsRef.current = ['/b']
  Object.assign(env, {
    novelWorkspaceCandidateRoots: ['/b'], novelWorkspaceCandidateKey: '/b',
    activeWritingWorkspaceRoot: '/b', rightWorkspaceVisible: true,
    setNovelWorkspaceFiles: () => {}, setNovelWorkspaceDirectories: () => {}, setNovelWorkspaceTruncated: () => {},
    setNovelWorkspaceDetecting: () => {}, setNovelWorkspaceDetectionSettledKey: () => {},
    markNovelWorkspaceFileChangesCovered: () => {},
  })
  const cleanup = runEffect('async function detectNovelWorkspace')
  expect(published).toEqual([{ root: null }])
  cleanup()
  requests[0].resolve(catalog('b.md'))
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(published).toEqual([{ root: null }])
})
it('relink and removal invalidate both snapshots and pending requests, including inactive Projects', async () => {
  const { env, requests, published, runEffect } = harness()
  env.novelWorkspaceCatalogCacheRef.current.set('/a', catalog('a.md'))
  env.novelWorkspaceCatalogCacheRef.current.set('/new', catalog('unrelated-old-snapshot.md'))
  const old = env.refreshNovelWorkspaceFiles('/a')
  env.catalogProjectLocatorsRef = { current: new Map([['project-a', '/a']]) }
  env.workspaces = [{ id: 'project-a', rootPath: '/new' }]
  runEffect('catalogProjectLocatorsRef.current = next')
  requests[0].resolve(catalog('stale-a.md'))
  expect(await old).toBe(false)
  expect(env.novelWorkspaceCatalogCacheRef.current.size).toBe(0)
  expect(published).toEqual([])
  env.novelWorkspaceCatalogCacheRef.current.set('/new', catalog('new.md'))
  env.workspaces = []
  runEffect('catalogProjectLocatorsRef.current = next')
  expect(env.novelWorkspaceCatalogCacheRef.current.size).toBe(0)
})

it.each(['old-first', 'new-first'])('A → B → external changes → A reads after activation and rejects late A (%s)', async order => {
  const { env, requests, published, runEffect } = harness()
  const frames: Array<() => void> = []
  const covered: string[] = []
  Object.assign(env, {
    window: { requestAnimationFrame: (callback: () => void) => frames.push(callback) },
    rightWorkspaceVisible: true, setNovelWorkspaceDetecting: () => {}, setNovelWorkspaceDetectionSettledKey: () => {},
    markNovelWorkspaceFileChangesCovered: (_root: string, signature: string) => covered.push(signature),
  })
  const activate = (root: string) => {
    env.novelWorkspaceCandidateRoots = [root]
    env.novelWorkspaceCandidateRootsRef.current = [root]
    env.novelWorkspaceCandidateKey = root
    env.activeWritingWorkspaceRoot = root
    runEffect('invalidateNovelWorkspaceCatalogRequests(rootPath, true)')
  }
  const previous = catalog('removed.md')
  const staleRpc = catalog('removed.md')
  activate('/a')
  env.novelWorkspaceCatalogCacheRef.current.set('/a', previous)
  const old = env.refreshNovelWorkspaceFiles('/a') // Host captures old disk state; transport is delayed.
  activate('/b')
  const changedDisk = catalog('added.md') // External create + delete while away.
  activate('/a')
  runEffect('async function detectNovelWorkspace')
  expect(published).toEqual([{ root: '/a' }, previous]) // Cached first frame survives.
  expect(requests).toHaveLength(1)
  frames.shift()!(); frames.shift()!()
  expect(requests).toHaveLength(2) // A read actually starts after this activation.
  const fresh = env.refreshNovelWorkspaceFiles('/a')
  expect(requests).toHaveLength(2) // Same-activation callers still coalesce.
  if (order === 'old-first') {
    requests[0].resolve(staleRpc)
    expect(await old).toBe(false)
    expect(covered).toEqual([])
    expect(published).not.toContain(staleRpc)
    const duplicate = env.refreshNovelWorkspaceFiles('/a')
    expect(requests).toHaveLength(2)
    requests[1].resolve(changedDisk)
    expect(await duplicate).toBe(true)
  } else {
    requests[1].resolve(changedDisk)
    expect(await fresh).toBe(true)
    requests[0].resolve(staleRpc)
    expect(await old).toBe(false)
  }
  expect(await fresh).toBe(true)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(env.novelWorkspaceCatalogCacheRef.current.get('/a')).toBe(changedDisk)
  expect(published.at(-1)).toBe(changedDisk)
  expect(published).not.toContain(staleRpc)
  expect(covered).toEqual(['signature-at-start'])
})

it.each(['relink', 'remove'])('Windows %s invalidates canonical snapshots and delayed requests', async operation => {
  const { env, requests, published, runEffect } = harness()
  const rawRoot = 'C:\\project\\'
  const root = getNovelWorkspaceCandidateRoots({ activeWorkspaceRootPath: rawRoot })[0]!
  expect(root).toBe('C:/project')
  env.catalogProjectLocatorsRef = { current: new Map() }
  env.workspaces = [{ id: 'project-a', rootPath: rawRoot }]
  runEffect('catalogProjectLocatorsRef.current = next')
  env.novelWorkspaceCandidateRootsRef.current = [root]
  env.novelWorkspaceCatalogCacheRef.current.set(root, catalog('cached.md'))
  env.novelWorkspaceCatalogCacheRef.current.set('D:/moved', catalog('old-target.md'))
  const old = env.refreshNovelWorkspaceFiles(root)
  env.workspaces = operation === 'relink' ? [{ id: 'project-a', rootPath: 'D:\\moved\\' }] : []
  runEffect('catalogProjectLocatorsRef.current = next')
  expect(env.novelWorkspaceCatalogCacheRef.current.has(root)).toBe(false)
  if (operation === 'relink') expect(env.novelWorkspaceCatalogCacheRef.current.has('D:/moved')).toBe(false)
  requests[0].resolve(catalog('late.md')) // Even if the same root is associated again, its old revision is gone.
  expect(await old).toBe(false)
  expect(published).toEqual([])
  expect(env.novelWorkspaceCatalogCacheRef.current.has(root)).toBe(false)
})
it('equivalent Windows separators and trailing slashes do not cancel a current read', async () => {
  const { env, requests, runEffect } = harness()
  env.catalogProjectLocatorsRef = { current: new Map() }
  env.workspaces = [{ id: 'a', rootPath: 'C:\\project\\' }]
  runEffect('catalogProjectLocatorsRef.current = next')
  env.novelWorkspaceCandidateRootsRef.current = ['C:/project']
  const pending = env.refreshNovelWorkspaceFiles('C:/project')
  env.workspaces = [{ id: 'a', rootPath: 'C:/project///' }]
  runEffect('catalogProjectLocatorsRef.current = next')
  requests[0].resolve(catalog('current.md'))
  expect(await pending).toBe(true)
})
