import { describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const app = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8')
const rail = readFileSync(new URL('../ActivityRail.tsx', import.meta.url), 'utf8')
const rows = readFileSync(new URL('../ActivityRailRows.tsx', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8')

// Execute the actual callbacks without mounting the desktop's native providers.
function callback(source: string, name: string, context: Record<string, unknown>): (...args: any[]) => Promise<any> {
  const file = ts.createSourceFile('test.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression = ''
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name && node.initializer) {
      expression = (ts.isCallExpression(node.initializer) ? node.initializer.arguments[0]! : node.initializer).getText(file)
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) expression = node.getText(file).replace('export ', '')
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (!expression) throw new Error(`Missing callback: ${name}`)
  const js = ts.transpileModule(`const result = ${expression}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(context), `${js}; return result`)(...Object.values(context))
}
function deferred<T = any>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
function cell<T>(initial: T) {
  let value = initial
  return { get: () => value, set: (next: T | ((previous: T) => T)) => { value = typeof next === 'function' ? (next as (previous: T) => T)(value) : next } }
}
function activation(api: Record<string, unknown> = {}) {
  const runtime = cell<any>(null), error = cell<any>(null), opening = cell<any>(null), state = cell('project-hub')
  const load = mock(async (_workspaceId: string, _generation: number) => [])
  const switched = mock(async (_id: string) => {})
  const context = {
    window: { electronAPI: { resolveRuntimeWorkspace: async (id: string) => ({ id }), switchWorkspace: switched, ...api } },
    workspaceSelectionGenerationRef: { current: 0 }, workspaceOpenTargetRef: { current: null },
    workspaceSwitchInFlightRef: { current: null }, lastLoadedSessionsWorkspaceRef: { current: null },
    pendingCreatedWorkspaceRef: { current: null }, sessionDraftsRef: { current: new Map() },
    setOpeningWorkspace: opening.set, setWorkspaceOpenError: error.set, setStartupError() {},
    requestDocumentLeave: async () => true, withTimeout: (promise: Promise<any>) => promise,
    WORKSPACE_SWITCH_RPC_TIMEOUT_MS: 5000, FREE_CONVERSATION_WORKSPACE_ID: 'free', windowWorkspaceId: null,
    setRuntimeWorkspace: runtime.set, setWindowWorkspaceId() {}, setActiveProjectId() {}, setPendingReadyRoute() {},
    setAppState: state.set, setSessionsLoaded() {}, setSessionLoadError() {}, setSession() {},
    setPendingPermissions() {}, setPendingCredentials() {}, setPendingUserQuestions() {}, setSessionOptions() {},
    store: { set() {} }, sourcesAtom: '', skillsAtom: '', sessionMetadataReadyAtom: '', sessionMetaMapAtom: '', sessionIdsAtom: '',
    loadSessionsFromServer: load, formatSessionLoadFailure: String, console: { error() {} },
  }
  return { activate: callback(app, 'activateRuntimeWorkspace', context), context, runtime, error, opening, state, load, switched }
}

describe('project activation recovery', () => {
  it('discards an older resolution even when it finishes last', async () => {
    const first = deferred(), second = deferred()
    const h = activation({ resolveRuntimeWorkspace: (id: string) => id === 'a' ? first.promise : second.promise })
    const a = h.activate('a'); await tick()
    const b = h.activate('b'); await tick()
    second.resolve({ id: 'b' }); await b
    first.resolve({ id: 'a' }); await a
    expect(h.runtime.get().id).toBe('b')
    expect(h.switched.mock.calls).toEqual([['b']])
  })
  it('checks generation after the leave prompt', async () => {
    const leave = deferred<boolean>(), h = activation()
    h.context.requestDocumentLeave = () => leave.promise
    const activate = callback(app, 'activateRuntimeWorkspace', h.context)
    const a = activate('a'), b = activate('b')
    leave.resolve(true); await Promise.all([a, b])
    expect(h.switched.mock.calls).toEqual([['b']])
  })
  it('does not hydrate an obsolete switch completion', async () => {
    const first = deferred(), h = activation({ switchWorkspace: (id: string) => id === 'a' ? first.promise : Promise.resolve() })
    const a = h.activate('a'); await tick()
    await h.activate('b')
    first.resolve(undefined); await a
    expect(h.load.mock.calls.map(call => call[0])).toEqual(['b'])
  })
  it('catches resolution failure and retries the same target', async () => {
    const resolve = mock().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ id: 'a' })
    const h = activation({ resolveRuntimeWorkspace: resolve })
    await h.activate('a')
    expect(h.error.get()).toContain('offline')
    expect(h.opening.get()).toBeNull()
    await h.activate('a')
    expect(h.error.get()).toBeNull()
    expect(h.state.get()).toBe('ready')
    expect(h.switched).toHaveBeenCalledTimes(1)
  })
  it('old failures cannot overwrite a newer success', async () => {
    const first = deferred(), h = activation({ resolveRuntimeWorkspace: (id: string) => id === 'a' ? first.promise : Promise.resolve({ id }) })
    const a = h.activate('a'); await tick(); await h.activate('b')
    first.reject(new Error('old')); await a
    expect(h.error.get()).toBeNull()
    expect(h.runtime.get().id).toBe('b')
  })
})

function projectRefresh() {
  const requests: ReturnType<typeof deferred>[] = []
  const metas = cell<Record<string, any[]>>({ a: [{ id: 'cached' }] }), failed = cell(new Set<string>()), loading = cell(new Set<string>())
  const refresh = callback(rail, 'refreshProjectSessionMetas', {
    projectRefreshGenerations: { current: new Map() },
    window: { electronAPI: { listSessionsByWorkspace: () => { const d = deferred(); requests.push(d); return d.promise } } },
    setProjectSessionMetas: metas.set, setFailedProjectIds: failed.set, setLoadingProjectIds: loading.set,
    extractSessionMeta: (s: any) => s, hasSessionHistoryContent: () => true, console: { warn() {} },
  })
  return { refresh, requests, metas, failed, loading }
}
describe('project metadata refresh', () => {
  it('keeps latest results when older success arrives last', async () => {
    const h = projectRefresh(), a = h.refresh('a'), b = h.refresh('a')
    h.requests[1]!.resolve([{ id: 'new' }]); await b
    h.requests[0]!.resolve([{ id: 'old' }]); await a
    expect(h.metas.get().a).toEqual([{ id: 'new' }])
  })
  it('old failure cannot clear loading or mark the newer request failed', async () => {
    const h = projectRefresh(), a = h.refresh('a'), b = h.refresh('a')
    h.requests[0]!.reject(new Error('old')); await a
    expect(h.loading.get().has('a')).toBe(true)
    expect(h.failed.get().size).toBe(0)
    h.requests[1]!.resolve([]); await b
    expect(h.loading.get().size).toBe(0)
  })
  it('retains cached results on failure and clears failure after retry', async () => {
    const h = projectRefresh(), a = h.refresh('a')
    h.requests[0]!.reject(new Error('offline')); await a
    expect(h.metas.get().a).toEqual([{ id: 'cached' }])
    expect(h.failed.get().has('a')).toBe(true)
    const b = h.refresh('a'); h.requests[1]!.resolve([]); await b
    expect(h.metas.get().a).toEqual([])
    expect(h.failed.get().size).toBe(0)
  })
  it('tracks unrelated workspace requests independently', async () => {
    const h = projectRefresh(), a = h.refresh('a'), b = h.refresh('b')
    h.requests[1]!.resolve([{ id: 'b' }]); await b
    h.requests[0]!.resolve([{ id: 'a' }]); await a
    expect(h.metas.get()).toEqual({ a: [{ id: 'a' }], b: [{ id: 'b' }] })
  })
})

it('reports delete rejection once and consumes it', async () => {
  const error = mock(), remove = callback(rows, 'deleteConversationWithFeedback', { toast: { error } })
  await remove(async () => { throw new Error('offline') }, (key: string) => key)
  expect(error.mock.calls).toEqual([['sessions.delete.failed']])
  await remove(async () => {}, (key: string) => key)
  expect(error).toHaveBeenCalledTimes(1)
})
it('uses neutral project removal actions in both menus', () => {
  expect(rows).not.toContain('variant="destructive" onClick={onRemove}')
  expect(rows).not.toContain('variant="destructive" onSelect={onRemove}')
  expect(rows.match(/t\('workspace.removeFromList'\)/g)).toHaveLength(2)
})
it('ignores IME confirmation, but submits deliberate Enter', () => {
  const dialog = readFileSync(new URL('../../workspace/WorkspaceCreateEntryDialog.tsx', import.meta.url), 'utf8')
  const fragment = dialog.slice(dialog.indexOf('value={value}'))
  const body = fragment.match(/onKeyDown=\{\(event\) => \{([\s\S]*?)\n              \}\}/)![1]!
  const submit = mock(), handler = new Function('event', 'onSubmit', body)
  for (const nativeEvent of [{ isComposing: true, keyCode: 13 }, { isComposing: false, keyCode: 229 }]) {
    const preventDefault = mock(); handler({ key: 'Enter', nativeEvent, preventDefault }, submit)
    expect(preventDefault).not.toHaveBeenCalled()
  }
  handler({ key: 'Enter', nativeEvent: { isComposing: false, keyCode: 13 }, preventDefault() {} }, submit)
  expect(submit).toHaveBeenCalledTimes(1)
})
it('memoizes rail actions with all callbacks as dependencies', () => {
  expect(shell).toContain('sessionActions={activityRailSessionActions}')
  expect(shell).toContain('[onRenameSession, onPinSession, onUnpinSession, onArchiveSession, handleDeleteSession]')
})

it('starts independent startup RPCs together without waiting for auth', async () => {
  const windowId = deferred(), catalog = deferred(), auth = deferred()
  const getWorkspaces = mock(() => catalog.promise), getWindowWorkspace = mock(() => windowId.promise), state = cell('loading')
  const initialize = callback(app, 'initialize', {
    performance: { mark() {} }, setStartupError() {}, loadClientAuthState: () => auth.promise,
    window: { electronAPI: { getWorkspaces, getWindowWorkspace } }, withTimeout: (p: Promise<any>) => p,
    STARTUP_RPC_TIMEOUT_MS: 5000, setWorkspaces() {}, setRuntimeWorkspace() {}, setWindowWorkspaceId() {},
    setActiveProjectId() {}, selectStartupWorkspaceId: () => null, resolvePostSetupAppState: () => 'project-hub',
    setAppState: state.set, formatSessionLoadFailure: String, console: { error() {} },
  })
  const run = initialize()
  expect(getWorkspaces).toHaveBeenCalledTimes(1)
  expect(getWindowWorkspace).toHaveBeenCalledTimes(1)
  windowId.resolve(null); catalog.resolve([]); await run
  expect(state.get()).toBe('project-hub')
})
it('bounds auth RPC and consumes timeout failure', async () => {
  const timeout = mock(async (_promise: Promise<unknown>, _timeout: number, _label: string) => { throw new Error('timeout') }), set = mock()
  const load = callback(app, 'loadClientAuthState', {
    window: { electronAPI: { getClientAuthState: () => new Promise(() => {}) } },
    withTimeout: timeout, STARTUP_RPC_TIMEOUT_MS: 5000, setClientAuthState: set, console: { error() {} },
  })
  expect(await load()).toBeNull()
  expect(timeout.mock.calls[0]!.slice(1)).toEqual([5000, 'getClientAuthState'])
  expect(set).not.toHaveBeenCalled()
})
it('surfaces startup failure on the hub instead of silently dropping it', async () => {
  const error = cell<any>(null), state = cell('loading')
  const initialize = callback(app, 'initialize', {
    performance: { mark() {} }, setStartupError: error.set, loadClientAuthState: async () => null,
    window: { electronAPI: { getWorkspaces: async () => { throw new Error('offline') }, getWindowWorkspace: async () => null } },
    withTimeout: (p: Promise<any>) => p, STARTUP_RPC_TIMEOUT_MS: 5000,
    setAppState: state.set, formatSessionLoadFailure: String, console: { error() {} },
  })
  await initialize()
  expect(error.get()).toContain('offline')
  expect(state.get()).toBe('project-hub')
  const hub = app.slice(app.indexOf("if (appState === 'project-hub')"))
  expect(hub).toContain('role="alert"')
  expect(hub).toContain('setStartupAttempt(attempt => attempt + 1)')
  expect(hub).toContain('activateRuntimeWorkspace(target.id, target.route)')
})
