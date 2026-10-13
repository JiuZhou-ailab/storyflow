// input: Fake agent turns and deterministic gates across stop cleanup and abort
// output: Regression coverage for generation ownership, queue order, and provider errors
// pos: Guards SessionManager turn completion and invalidation persistence
import { afterEach, beforeEach, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionManager, createManagedSession } from './SessionManager'
import { getSessionFilePath } from '@craft-agent/shared/sessions/storage'

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}
let root: string
let manager: SessionManager
let internal: any
let managed: ReturnType<typeof createManagedSession>
let events: any[]
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'turn-generation-')))
  mkdirSync(join(root, '.craft-agent'))
  writeFileSync(join(root, '.craft-agent/config.json'), JSON.stringify({ id: 'directory', name: 'Test', slug: 'test', createdAt: 1, updatedAt: 1 }))
  manager = new SessionManager((_id, session) => session.workspace)
  internal = manager
  managed = createManagedSession({ id: 'turn-test', name: 'Test' }, { id: 'ws', name: 'Test', slug: 'test', rootPath: root, directoryConfigId: 'directory', createdAt: 1 }, { messagesLoaded: true })
  internal.sessions.set(managed.id, managed)
  events = []
  internal.sendEvent = (event: any) => events.push(event)
})
afterEach(async () => {
  await manager.flushAllSessions()
  manager.cleanup()
  rmSync(root, { recursive: true, force: true })
})
function installChat(chat: (...args: any[]) => AsyncGenerator<any>) {
  const agent = { getModel: () => 'test-model', setAllSources() {}, getSessionId: () => undefined, dispose() {}, forceAbort() {}, chat }
  internal.getOrCreateAgentLocked = async () => agent
}

it('queues sends during async completion cleanup and reserves replay admission', async () => {
  const started = gate(), finish = gate(), cleaning = gate(), clear = gate(), allDone = gate()
  const chats: string[] = []
  let active = 0, maxActive = 0
  installChat(async function* (message: string) {
    active++; maxActive = Math.max(maxActive, active); chats.push(message)
    try {
      if (message === 'first') { started.resolve(); await finish.promise }
      yield { type: 'text_complete', text: `reply:${message}` }
      yield { type: 'complete' }
    } finally { active--; if (message === 'third') allDone.resolve() }
  })
  let firstClear = true
  internal.browserPaneManager = {
    async clearVisualsForSession() { if (firstClear) { firstClear = false; cleaning.resolve(); await clear.promise } },
    unbindAllForSession() {},
  }
  const first = manager.sendMessage(managed.id, 'first')
  await started.promise
  await manager.sendMessage(managed.id, 'second')
  finish.resolve()
  await cleaning.promise
  await manager.sendMessage(managed.id, 'third')
  expect(chats).toEqual(['first'])
  expect(managed.isProcessing).toBe(true)
  clear.resolve()
  await first
  await allDone.promise
  expect(chats).toEqual(['first', 'second', 'third'])
  expect(maxActive).toBe(1)
  expect(events.some(event => event.type === 'typed_error')).toBe(false)
})

it('drains a timed-out iterator before the next chat and ignores its stale stop', async () => {
  const started = gate(), abort = gate(), nextStarted = gate(), finishNext = gate(), done = gate()
  const chats: string[] = []
  installChat(async function* (message: string) {
    chats.push(message)
    if (message === 'first') {
      started.resolve(); await abort.promise
      throw new DOMException('late abort', 'AbortError')
    }
    nextStarted.resolve(); await finishNext.promise
    try { yield { type: 'complete' } } finally { done.resolve() }
  })
  const first = manager.sendMessage(managed.id, 'first')
  await started.promise
  const generation = managed.processingGeneration
  await manager.sendMessage(managed.id, 'second')
  await internal.onProcessingStopped(managed.id, 'timeout', generation)
  // Replay admission can advance, but shared Pi chat must not overlap the old iterator.
  await manager.sendMessage(managed.id, 'third')
  expect(chats).toEqual(['first'])
  abort.resolve()
  await first
  await nextStarted.promise
  expect(managed.processingGeneration).toBeGreaterThan(generation)
  await internal.onProcessingStopped(managed.id, 'interrupted', generation)
  expect(managed.isProcessing).toBe(true)
  managed.messageQueue = []
  finishNext.resolve()
  await done.promise
  expect(chats).toEqual(['first', 'second'])
})

it('surfaces a provider error containing aborted as an error', async () => {
  installChat(async function* () { throw new Error('provider transaction aborted by upstream overload') })
  await manager.sendMessage(managed.id, 'request')
  expect(events).toContainEqual(expect.objectContaining({ type: 'error', error: 'provider transaction aborted by upstream overload' }))
  expect(managed.isProcessing).toBe(false)
})

it('restores deferred writes across an invalidation epoch and resumes queued work', async () => {
  managed.runtimeState = 'invalidating'
  managed.runtimeEpoch = 1
  managed.messages.push({ id: 'reply', role: 'assistant', content: 'completed during exclusive operation', timestamp: 1 })
  internal.persistSession(managed)
  // A later shutdown/invalidation owner still owes this same live object's write.
  managed.runtimeEpoch = 2
  const claim = { sessions: [managed], runtimeEpochs: new Map([[managed.id, 2]]), workspace: managed.workspace, rootKeys: [], token: Symbol() }
  internal.projectLifecycle.restoreProjectInvalidation(claim)
  await manager.flushSession(managed.id)
  expect(readFileSync(getSessionFilePath(root, managed.id), 'utf8')).toContain('completed during exclusive operation')
  const replayed = gate()
  installChat(async function* () { try { yield { type: 'complete' } } finally { replayed.resolve() } })
  managed.messages.push({ id: 'queued', role: 'user', content: 'queued request', isQueued: true, timestamp: 2 })
  internal.projectLifecycle.releaseProjectTransition(claim)
  await replayed.promise
  expect(managed.messages.find(message => message.id === 'queued')?.isQueued).toBeFalsy()
})

it('unrefs stop fallback timers and clears them on a new turn, disposal, and cleanup', async () => {
  managed.isProcessing = true
  managed.agent = { forceAbort() {}, dispose() {} } as never
  await manager.cancelProcessing(managed.id)
  expect(internal.stopTimers.get(managed).hasRef()).toBe(false)
  internal.setProcessing(managed, true)
  expect(internal.stopTimers.has(managed)).toBe(false)
  await manager.cancelProcessing(managed.id)
  await internal.disposeManagedAgentRuntime(managed, 'test')
  expect(internal.stopTimers.has(managed)).toBe(false)
  managed.isProcessing = true
  await manager.cancelProcessing(managed.id)
  manager.cleanup()
  expect(internal.stopTimers.size).toBe(0)
  managed.isProcessing = false
})

it('flushes a deferred write when shutdown acquires a newer runtime epoch', async () => {
  managed.runtimeState = 'invalidating'
  managed.runtimeEpoch = 1
  managed.messages.push({ id: 'deferred', role: 'assistant', content: 'durable on shutdown', timestamp: 1 })
  internal.persistSession(managed)
  managed.runtimeState = undefined
  await manager.shutdown()
  expect(managed.runtimeEpoch).toBe(2)
  expect(readFileSync(getSessionFilePath(root, managed.id), 'utf8')).toContain('durable on shutdown')
})
