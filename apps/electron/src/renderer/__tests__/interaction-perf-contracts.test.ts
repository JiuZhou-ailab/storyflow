// input: Session atom source, streaming hot path, input draft layer, app shell wiring
// output: Deterministic CI proxy contracts for continuous/discrete interaction performance
// pos: ADR-0001 interaction-axis regression guard (re-render/subscription structure, not wall-clock)

import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createStore } from 'jotai'
import type { Message, Session } from '../../shared/types'
import {
  sessionAtomFamily,
  sessionMetaMapAtom,
  updateSessionAtom,
  loadedSessionsAtom,
  reconcileSessionTranscriptWorkingSetAtom,
  __resetSessionTranscriptWorkingSetForTests,
} from '../atoms/sessions'

const sessionsAtomSource = readFileSync(new URL('../atoms/sessions.ts', import.meta.url), 'utf8')
const freeFormInputSource = readFileSync(
  new URL('../components/app-shell/input/FreeFormInput.tsx', import.meta.url),
  'utf8',
)
const sessionListSource = readFileSync(
  new URL('../components/app-shell/SessionList.tsx', import.meta.url),
  'utf8',
)
const sessionItemSource = readFileSync(
  new URL('../components/app-shell/SessionItem.tsx', import.meta.url),
  'utf8',
)
const chatPageSource = readFileSync(new URL('../pages/ChatPage.tsx', import.meta.url), 'utf8')
const appShellSource = readFileSync(
  new URL('../components/app-shell/AppShell.tsx', import.meta.url),
  'utf8',
)
const textHandlerSource = readFileSync(
  new URL('../event-processor/handlers/text.ts', import.meta.url),
  'utf8',
)
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
const globalSearchSource = readFileSync(new URL('../lib/global-search.ts', import.meta.url), 'utf8')

function msg(id: string, role: Message['role'] = 'user', content = `content:${id}`): Message {
  return { id, role, content, timestamp: Date.now() }
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: overrides.id ?? 'session-1',
    workspaceId: overrides.workspaceId ?? 'workspace-1',
    messages: overrides.messages ?? [],
    permissionMode: overrides.permissionMode ?? 'ask',
    supportsBranching: overrides.supportsBranching ?? true,
    ...overrides,
  } as Session
}

describe('interaction perf contracts (ADR-0001 CI proxy)', () => {
  afterEach(() => {
    __resetSessionTranscriptWorkingSetForTests()
  })

  it('keeps typing drafts local with debounced parent sync (continuous axis)', () => {
    // FreeFormInput must not write parent draft on every keystroke synchronously.
    expect(freeFormInputSource).toContain('// Debounced sync to parent')
    expect(freeFormInputSource).toContain('syncTimeoutRef')
    expect(freeFormInputSource).toMatch(/setTimeout\([\s\S]*?onInputChange/)
    // Local ref is the typing source of truth between debounced flushes.
    expect(freeFormInputSource).toContain('inputRef.current')
  })

  it('streams text deltas without scanning the full transcript on the common path', () => {
    expect(textHandlerSource).toContain('getLastStreamingMessageIndex')
    expect(textHandlerSource).toContain('appendMessage(session, newMessage, false, false)')
    // Intermediate streaming must not bump lastMessageAt (keeps session list meta stable).
    expect(textHandlerSource).toContain('const shouldUpdateTimestamp = !event.isIntermediate')
  })

  it('patches structure-stable stream deltas without full turn regroup (continuous axis)', () => {
    // ChatDisplay must use the pure patch helper so stream frames do not re-walk
    // completed history on every text_delta. Full regroup remains the fallback.
    const chatDisplaySource = readFileSync(
      new URL('../components/app-shell/ChatDisplay.tsx', import.meta.url),
      'utf8',
    )
    expect(chatDisplaySource).toContain('tryPatchTurnsForStreamingContentChange')
    expect(chatDisplaySource).toContain('turnsCacheRef')
    expect(chatDisplaySource).toContain('groupMessagesByTurn(transcriptMessages)')
  })

  it('applies text_delta via session atom only (skips metadata map rebuild)', () => {
    // Continuous streaming must not thrash SessionList meta subscribers every chunk.
    expect(appSource).toContain("event.type === 'text_delta'")
    expect(appSource).toContain('// text_delta changes only the active session body; avoid rebuilding session metadata')
    expect(appSource).toContain('store.set(sessionAtomFamily(sessionId), updatedSession)')
    // Non-delta path still uses updateSessionDirect (meta-aware).
    expect(appSource).toContain('updateSessionDirect(sessionId, () => updatedSession)')
  })

  it('session list rows subscribe to meta / per-row atoms, not full message arrays', () => {
    expect(sessionListSource).toContain('workspaceSessionMetasAtom')
    expect(sessionListSource).not.toContain('sessionAtomFamily')
    expect(sessionItemSource).not.toContain('sessionAtomFamily')
    expect(sessionItemSource).not.toContain('.messages')
  })

  it('bounds full transcript residency with a working set reconcile on selection', () => {
    expect(sessionsAtomSource).toContain('reconcileSessionTranscriptWorkingSetAtom')
    expect(sessionsAtomSource).toContain('unloadSessionTranscriptAtom')
    expect(sessionsAtomSource).toContain('SESSION_TRANSCRIPT_WORKING_SET_EXTRA')
    // Main-process dual: renderer eviction best-effort releases idle main transcripts.
    expect(sessionsAtomSource).toContain('releaseSessionMessages')
    expect(appShellSource).toContain('reconcileSessionTranscriptWorkingSet')
    expect(appShellSource).toContain('reconcileSessionTranscriptWorkingSet(openIds)')
  })

  it('bounds novel version baselines so document open/close cannot retain every chapter', () => {
    expect(appShellSource).toContain('NOVEL_VERSION_BASELINE_WORKING_SET')
    expect(appShellSource).toContain('rememberNovelVersionBaseline')
    expect(appShellSource).toContain('pruneNovelVersionBaselines')
    expect(appShellSource).not.toMatch(
      /novelVersionBaselinesRef\.current\[selectedNovelDocumentPath\]\s*\?\?=/,
    )
  })

  it('reuses the manuscript TipTap editor across chapter switches', () => {
    const editorPanelSource = readFileSync(
      new URL('../components/writing/NovelDocumentEditorPanel.tsx', import.meta.url),
      'utf8',
    )
    expect(editorPanelSource).not.toContain('key={file.path}')
    // Loading overlay must not unmount the editor (remount = ProseMirror leak surface).
    expect(editorPanelSource).toContain('Keep the editor mounted during loads')
    expect(editorPanelSource).toContain('editable={!loading}')
  })

  it('does not rewrite panel stack for same-route writing navigations (chapter switch)', () => {
    // handleSelectNovelFile re-calls navigate('writing') on every chapter click.
    // updateFocusedPanelRouteAtom must no-op when focused route is already writing,
    // otherwise panelStack identity thrash re-renders AppShell and syncs URL.
    const panelStackSource = readFileSync(
      new URL('../atoms/panel-stack.ts', import.meta.url),
      'utf8',
    )
    expect(panelStackSource).toContain('if (focused.route === route)')
    expect(panelStackSource).toContain('// Chapter switches (and other in-surface actions) re-call navigate')
  })

  it('starts session-switch timing for every ChatPage entry path', () => {
    // Guards discrete interaction instrumentation for list, history menu, and navigate().
    expect(chatPageSource).toContain('rendererPerf.startSessionSwitch(sessionId)')
    expect(chatPageSource).toContain('rendererPerf.endSessionSwitch(sessionId)')
  })

  it('caps global search result groups (heavy-search pure bound)', () => {
    expect(globalSearchSource).toContain('MAX_RESULTS_PER_GROUP = 8')
    expect(globalSearchSource).toContain('insertBoundedResult')
  })

  it('does not rewrite session metadata when only message content changes', () => {
    // Proxy for "streaming into active session does not thrash SessionList meta".
    const store = createStore()
    const sessionId = 'session-active'
    // Seed through updateSessionAtom so meta matches extractSessionMeta exactly.
    store.set(updateSessionAtom, sessionId, () => makeSession({
      id: sessionId,
      name: 'Stable title',
      messages: [msg('m1', 'assistant', 'hello')],
      lastMessageAt: 1000,
    }))
    const metaBefore = store.get(sessionMetaMapAtom)

    store.set(updateSessionAtom, sessionId, (prev) => {
      if (!prev) return prev
      return {
        ...prev,
        messages: [{ ...prev.messages[0], content: 'hello world stream' }],
      }
    })

    const metaAfter = store.get(sessionMetaMapAtom)
    expect(metaAfter).toBe(metaBefore)
    expect(store.get(sessionAtomFamily(sessionId))?.messages[0]?.content).toBe('hello world stream')
  })

  it('evicts out-of-working-set transcripts after multi-session load (memory×interaction)', () => {
    const store = createStore()
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      store.set(sessionAtomFamily(id), makeSession({
        id,
        messages: [msg(`${id}-1`), msg(`${id}-2`, 'assistant')],
      }))
    }
    store.set(loadedSessionsAtom, new Set(['a', 'b', 'c', 'd', 'e']))
    __resetSessionTranscriptWorkingSetForTests()

    store.set(reconcileSessionTranscriptWorkingSetAtom, ['e'])

    expect(store.get(loadedSessionsAtom).has('e')).toBe(true)
    expect(store.get(sessionAtomFamily('e'))?.messages.length).toBe(2)
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(store.get(loadedSessionsAtom).has(id)).toBe(false)
      expect(store.get(sessionAtomFamily(id))?.messages).toEqual([])
    }
  })
})
