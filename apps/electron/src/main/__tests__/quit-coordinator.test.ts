// input: Electron before-quit events, update state, and application cleanup callbacks
// output: Regression coverage for normal and updater-owned quit sequencing
// pos: Protects the updater handoff from generic main-process quit interception

import { describe, expect, it, mock } from 'bun:test'
import { createQuitCoordinator } from '../quit-coordinator'

describe('quit coordinator', () => {
  it('prepares once before a normal app exit', async () => {
    const order: string[] = []
    const preventDefault = mock(() => order.push('prevent'))
    const prepare = mock(async () => { order.push('prepare') })
    const exit = mock(() => order.push('exit'))
    const coordinator = createQuitCoordinator({
      isUpdating: () => false,
      prepare,
      exit,
    })

    await coordinator.handleBeforeQuit({ preventDefault })

    expect(order).toEqual(['prevent', 'prepare', 'exit'])
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('reuses completed preparation across quit paths', async () => {
    const prepare = mock(async () => {})
    const coordinator = createQuitCoordinator({
      isUpdating: () => false,
      prepare,
      exit: () => {},
    })

    await coordinator.prepare()
    await coordinator.prepare()

    expect(prepare).toHaveBeenCalledTimes(1)
  })

  it('does not intercept an updater-owned quit after preparation', async () => {
    let updating = false
    const preventDefault = mock(() => {})
    const prepare = mock(async () => {})
    const exit = mock(() => {})
    const coordinator = createQuitCoordinator({
      isUpdating: () => updating,
      prepare,
      exit,
    })

    await coordinator.prepare()
    updating = true
    await coordinator.handleBeforeQuit({ preventDefault })

    expect(preventDefault).not.toHaveBeenCalled()
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(exit).not.toHaveBeenCalled()
  })
})

describe('quit coordinator exit guarantees', () => {
  it('still exits when preparation throws', async () => {
    const exit = mock(() => {})
    const incomplete = mock(() => {})
    const coordinator = createQuitCoordinator({
      isUpdating: () => false,
      prepare: async () => { throw new Error('cleanup exploded') },
      exit,
      onPrepareIncomplete: incomplete,
    })

    await coordinator.handleBeforeQuit({ preventDefault: () => {} })

    expect(exit).toHaveBeenCalledWith(0)
    expect(incomplete).toHaveBeenCalledWith('failed', expect.any(Error))
  })

  it('exits once the deadline elapses even if preparation never settles', async () => {
    const exit = mock(() => {})
    const incomplete = mock(() => {})
    const coordinator = createQuitCoordinator({
      isUpdating: () => false,
      prepare: () => new Promise(() => {}),
      exit,
      deadlineMs: 20,
      onPrepareIncomplete: incomplete,
    })

    await coordinator.handleBeforeQuit({ preventDefault: () => {} })

    expect(exit).toHaveBeenCalledWith(0)
    expect(incomplete).toHaveBeenCalledWith('timed-out')
  })

  it('does not report a timeout after preparation completed', async () => {
    const incomplete = mock(() => {})
    const coordinator = createQuitCoordinator({
      isUpdating: () => false,
      prepare: async () => {},
      exit: () => {},
      deadlineMs: 10,
      onPrepareIncomplete: incomplete,
    })

    await coordinator.prepare()
    await new Promise(resolve => setTimeout(resolve, 30))

    expect(incomplete).not.toHaveBeenCalled()
  })
})
