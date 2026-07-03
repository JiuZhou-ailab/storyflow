import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import type { BrowserInstanceInfo } from '../../../shared/types'
import {
  browserInstanceForSessionAtomFamily,
  browserInstancesAtom,
  removeBrowserInstanceAtom,
  setBrowserInstancesAtom,
  updateBrowserInstanceAtom,
} from '../browser-pane'

function makeInstance(id: string, overrides: Partial<BrowserInstanceInfo> = {}): BrowserInstanceInfo {
  return {
    id,
    url: 'https://example.com',
    title: 'Example',
    favicon: null,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    boundSessionId: null,
    ownerType: 'manual',
    ownerSessionId: null,
    isVisible: true,
    agentControlActive: false,
    themeColor: null,
    ...overrides,
  }
}

describe('browser pane atoms', () => {
  it('does not resurrect removed instance from stale update event', () => {
    const store = createStore()

    store.set(updateBrowserInstanceAtom, makeInstance('browser-1'))
    expect(store.get(browserInstancesAtom).map((i) => i.id)).toEqual(['browser-1'])

    store.set(removeBrowserInstanceAtom, 'browser-1')
    expect(store.get(browserInstancesAtom)).toHaveLength(0)

    // Simulate late out-of-order state event arriving after removal
    store.set(updateBrowserInstanceAtom, makeInstance('browser-1'))

    expect(store.get(browserInstancesAtom)).toHaveLength(0)
  })

  it('authoritative list refresh can restore an instance after prior remove', () => {
    const store = createStore()

    store.set(removeBrowserInstanceAtom, 'browser-2')
    expect(store.get(browserInstancesAtom)).toHaveLength(0)

    // Simulate full list() reconciliation from main process
    store.set(setBrowserInstancesAtom, [makeInstance('browser-2')])

    expect(store.get(browserInstancesAtom).map((i) => i.id)).toEqual(['browser-2'])
  })

  it('exposes a visible active browser instance per session without notifying on unrelated instances', () => {
    const store = createStore()
    const currentBrowserAtom = browserInstanceForSessionAtomFamily('session-1')
    let notifications = 0

    store.set(setBrowserInstancesAtom, [
      makeInstance('browser-1', {
        boundSessionId: 'session-1',
        agentControlActive: true,
        isVisible: true,
      }),
      makeInstance('browser-2', {
        boundSessionId: 'session-2',
        agentControlActive: true,
        isVisible: true,
      }),
    ])

    const unsubscribe = store.sub(currentBrowserAtom, () => {
      notifications += 1
    })

    expect(store.get(currentBrowserAtom)?.id).toBe('browser-1')

    store.set(updateBrowserInstanceAtom, makeInstance('browser-2', {
      boundSessionId: 'session-2',
      agentControlActive: true,
      isVisible: true,
      url: 'https://other.example',
    }))
    expect(store.get(currentBrowserAtom)?.id).toBe('browser-1')
    expect(notifications).toBe(0)

    store.set(updateBrowserInstanceAtom, makeInstance('browser-1', {
      boundSessionId: 'session-1',
      agentControlActive: true,
      isVisible: true,
      url: 'https://current.example',
    }))
    expect(store.get(currentBrowserAtom)?.url).toBe('https://current.example')
    expect(notifications).toBe(1)

    unsubscribe()
  })
})
