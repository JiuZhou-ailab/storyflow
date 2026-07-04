// input: App renderer source
// output: Guards background task atom access on unrelated agent events
// pos: Keeps streaming events from touching background task atoms

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf-8')

describe('background task event hot path', () => {
  it('returns before touching background task atoms for unrelated event types', () => {
    const functionStart = appSource.indexOf('function handleBackgroundTaskEvent(')
    const atomLookup = appSource.indexOf('backgroundTasksAtomFamily(sessionId)', functionStart)
    const earlyReturn = appSource.indexOf('if (!BACKGROUND_TASK_EVENT_TYPES.has(event.type)) return', functionStart)

    expect(functionStart).toBeGreaterThan(-1)
    expect(earlyReturn).toBeGreaterThan(functionStart)
    expect(earlyReturn).toBeLessThan(atomLookup)
  })

  it('routes text deltas with an existing session atom through the direct atom fast path', () => {
    const fastPathStart = appSource.indexOf("const isTextDeltaFastPath = event.type === 'text_delta' && !!atomSession")
    const branchStart = appSource.indexOf('if (isStreaming || isHandoff || isTextDeltaFastPath)', fastPathStart)
    const branchEnd = appSource.indexOf('// Not streaming: use per-session atoms directly', branchStart)
    const branchSource = appSource.slice(branchStart, branchEnd)

    expect(fastPathStart).toBeGreaterThan(-1)
    expect(branchStart).toBeGreaterThan(fastPathStart)
    expect(branchSource).toContain("if (event.type === 'text_delta') {")
    expect(branchSource).toContain('store.set(sessionAtomFamily(sessionId), updatedSession)')
    expect(branchSource).toContain('updateSessionDirect(sessionId, () => updatedSession)')
  })
})
