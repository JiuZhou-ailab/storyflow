import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import type { BrowserInstanceInfo } from '../../../shared/types'
import {
  browserInstanceForSessionAtomFamily,
  browserInstancesMapAtom,
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
    expect([...store.get(browserInstancesMapAtom).keys()]).toEqual(['browser-1'])

    store.set(removeBrowserInstanceAtom, 'browser-1')
    expect(store.get(browserInstancesMapAtom)).toHaveLength(0)

    // Simulate late out-of-order state event arriving after removal
    store.set(updateBrowserInstanceAtom, makeInstance('browser-1'))

    expect(store.get(browserInstancesMapAtom)).toHaveLength(0)
  })

  it('authoritative list refresh can restore an instance after prior remove', () => {
    const store = createStore()

    store.set(removeBrowserInstanceAtom, 'browser-2')
    expect(store.get(browserInstancesMapAtom)).toHaveLength(0)

    // Simulate full list() reconciliation from main process
    store.set(setBrowserInstancesAtom, [makeInstance('browser-2')])

    expect([...store.get(browserInstancesMapAtom).keys()]).toEqual(['browser-2'])
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

  it('does not notify browser instance subscribers for duplicate single-instance updates', () => {
    const store = createStore()

    store.set(updateBrowserInstanceAtom, makeInstance('browser-1'))
    const beforeMap = store.get(browserInstancesMapAtom)
    let notifications = 0
    const unsubscribe = store.sub(browserInstancesMapAtom, () => {
      notifications += 1
    })

    store.set(updateBrowserInstanceAtom, makeInstance('browser-1'))

    expect(store.get(browserInstancesMapAtom)).toBe(beforeMap)
    expect(notifications).toBe(0)

    unsubscribe()
  })

  it('does not notify browser instance subscribers for duplicate list refreshes', () => {
    const store = createStore()
    const instances = [
      makeInstance('browser-1'),
      makeInstance('browser-2', { url: 'https://second.example' }),
    ]

    store.set(setBrowserInstancesAtom, instances)
    const beforeMap = store.get(browserInstancesMapAtom)
    let notifications = 0
    const unsubscribe = store.sub(browserInstancesMapAtom, () => {
      notifications += 1
    })

    store.set(setBrowserInstancesAtom, [
      makeInstance('browser-1'),
      makeInstance('browser-2', { url: 'https://second.example' }),
    ])

    expect(store.get(browserInstancesMapAtom)).toBe(beforeMap)
    expect(notifications).toBe(0)

    unsubscribe()
  })
})
