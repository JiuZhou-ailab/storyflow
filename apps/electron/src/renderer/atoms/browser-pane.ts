/**
 * Browser Pane Atoms
 *
 * Jotai atoms for browser instance state in the renderer.
 * Synced from the main process via BROWSER_PANE_STATE_CHANGED IPC events.
 */

import { atom } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { atomFamily } from 'jotai-family'
import type { BrowserInstanceInfo } from '../../shared/types'

/** Map of all browser instances by ID */
export const browserInstancesMapAtom = atom<Map<string, BrowserInstanceInfo>>(new Map())

/** Derived: array of all browser instances (for iteration) */
export const browserInstancesAtom = atom<BrowserInstanceInfo[]>(
  (get) => Array.from(get(browserInstancesMapAtom).values())
)

export const browserInstanceForSessionAtomFamily = atomFamily(
  (sessionId: string | undefined) => selectAtom(
    browserInstancesMapAtom,
    (map) => {
      if (!sessionId) return null
      let match: BrowserInstanceInfo | null = null
      for (const instance of map.values()) {
        if (instance.boundSessionId === sessionId && instance.agentControlActive && instance.isVisible) {
          match = instance
        }
      }
      return match
    },
    Object.is,
  ),
  (a, b) => a === b,
)

/** Currently active browser instance ID (selected/focused by user interactions) */
export const activeBrowserInstanceIdAtom = atom<string | null>(null)

/** Tombstones for instances removed from renderer state (guards against late out-of-order updates) */
export const removedBrowserInstanceIdsAtom = atom<Set<string>>(new Set<string>())

function browserInstanceEqual(a: BrowserInstanceInfo, b: BrowserInstanceInfo): boolean {
  const aKeys = Object.keys(a) as Array<keyof BrowserInstanceInfo>
  const bKeys = Object.keys(b) as Array<keyof BrowserInstanceInfo>
  return aKeys.length === bKeys.length && aKeys.every(key => Object.is(a[key], b[key]))
}

function browserInstancesMapEqual(
  map: Map<string, BrowserInstanceInfo>,
  instances: BrowserInstanceInfo[],
): boolean {
  return map.size === instances.length
    && instances.every(info => {
      const current = map.get(info.id)
      return !!current && browserInstanceEqual(current, info)
    })
}

/** Update a single browser instance (from IPC state change event) */
export const updateBrowserInstanceAtom = atom(
  null,
  (get, set, info: BrowserInstanceInfo) => {
    const removedIds = get(removedBrowserInstanceIdsAtom)
    if (removedIds.has(info.id)) {
      return
    }

    const currentMap = get(browserInstancesMapAtom)
    const current = currentMap.get(info.id)
    if (current && browserInstanceEqual(current, info)) return

    const map = new Map(currentMap)
    map.set(info.id, info)
    set(browserInstancesMapAtom, map)
  }
)

/** Remove a browser instance (when destroyed) */
export const removeBrowserInstanceAtom = atom(
  null,
  (get, set, id: string) => {
    const map = new Map(get(browserInstancesMapAtom))
    map.delete(id)
    set(browserInstancesMapAtom, map)

    const removedIds = new Set(get(removedBrowserInstanceIdsAtom))
    removedIds.add(id)
    set(removedBrowserInstanceIdsAtom, removedIds)
  }
)

/** Set all browser instances at once (from list query) */
export const setBrowserInstancesAtom = atom(
  null,
  (get, set, instances: BrowserInstanceInfo[]) => {
    const currentMap = get(browserInstancesMapAtom)
    if (!browserInstancesMapEqual(currentMap, instances)) {
      const map = new Map<string, BrowserInstanceInfo>()
      for (const info of instances) {
        map.set(info.id, info)
      }
      set(browserInstancesMapAtom, map)
    }

    const currentRemovedIds = get(removedBrowserInstanceIdsAtom)
    let removedIds: Set<string> | null = null
    for (const info of instances) {
      if (currentRemovedIds.has(info.id)) {
        removedIds ??= new Set(currentRemovedIds)
        removedIds.delete(info.id)
      }
    }
    if (removedIds) {
      set(removedBrowserInstanceIdsAtom, removedIds)
    }
  }
)
