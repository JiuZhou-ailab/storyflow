// input: Renderer input-setting loader helpers
// output: Regression coverage for input-setting IPC deduplication
// pos: Keeps chat UI setting reads from duplicating mount-time IPC calls

import { afterEach, describe, expect, it } from 'bun:test'
import { loadSendMessageKeySetting } from '../input-settings'

describe('loadSendMessageKeySetting', () => {
  const originalWindow = globalThis.window

  afterEach(() => {
    if (originalWindow) {
      globalThis.window = originalWindow
    } else {
      // @ts-expect-error test cleanup for window shim
      delete globalThis.window
    }
  })

  it('deduplicates concurrent send-key IPC reads without caching settled values', async () => {
    let calls = 0
    let resolveFirst: (value: 'enter' | 'cmd-enter') => void = () => {}

    globalThis.window = {
      electronAPI: {
        getSendMessageKey: () => {
          calls += 1
          return new Promise<'enter' | 'cmd-enter'>((resolve) => {
            resolveFirst = resolve
          })
        },
      },
    } as unknown as typeof window

    const first = loadSendMessageKeySetting()
    const second = loadSendMessageKeySetting()
    expect(calls).toBe(1)

    resolveFirst('cmd-enter')
    await expect(first).resolves.toBe('cmd-enter')
    await expect(second).resolves.toBe('cmd-enter')

    globalThis.window = {
      electronAPI: {
        getSendMessageKey: async () => {
          calls += 1
          return 'enter'
        },
      },
    } as unknown as typeof window

    await expect(loadSendMessageKeySetting()).resolves.toBe('enter')
    expect(calls).toBe(2)
  })
})
