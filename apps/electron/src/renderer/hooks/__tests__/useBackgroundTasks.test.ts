// input: useBackgroundTasks hook source
// output: Regression coverage for stable background task actions
// pos: Keeps task progress ticks from rebroadcasting action callbacks

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../useBackgroundTasks.ts', import.meta.url), 'utf-8')

describe('useBackgroundTasks action stability', () => {
  it('keeps killTask independent of the ticking task list', () => {
    expect(source).not.toContain('const task = tasks.find')
    expect(source).toContain('}, [sessionId, setTasks])')
    expect(source).not.toContain('}, [sessionId, tasks, setTasks])')
  })
})
