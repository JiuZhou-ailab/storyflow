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
