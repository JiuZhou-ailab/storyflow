// input: Renderer automations loader and mocked Electron automation APIs
// output: Regression coverage for duplicate workspace automation startup loads
// pos: Guards the hook boundary that hydrates workspace automations into UI state

import { describe, expect, it } from 'bun:test'
import { loadAutomationsForWorkspace, __resetAutomationsLoadCacheForTests } from '../useAutomations'

describe('loadAutomationsForWorkspace', () => {
  it('coalesces concurrent loads for the same workspace', async () => {
    __resetAutomationsLoadCacheForTests()

    let resolveConfig: (value: unknown) => void
    const configPromise = new Promise<unknown>((resolve) => {
      resolveConfig = resolve
    })

    let automationCalls = 0
    let historyCalls = 0
    const api = {
      getAutomations: async () => {
        automationCalls += 1
        return configPromise
      },
      getAutomationLastExecuted: async () => {
        historyCalls += 1
        return { 'SchedulerTick-0': 123 }
      },
    }

    const first = loadAutomationsForWorkspace('workspace-1', api)
    const second = loadAutomationsForWorkspace('workspace-1', api)

    resolveConfig!({
      version: 2,
      automations: {
        SchedulerTick: [
          { actions: [{ type: 'prompt', prompt: 'daily check' }] },
        ],
      },
    })

    const [firstItems, secondItems] = await Promise.all([first, second])

    expect(automationCalls).toBe(1)
    expect(historyCalls).toBe(1)
    expect(firstItems).toEqual(secondItems)
    expect(firstItems[0].lastExecutedAt).toBe(123)
  })
})
