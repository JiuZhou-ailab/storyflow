/**
 * Hook for persisting TurnCard expanded/collapsed state across session switches.
 *
 * Stores expansion state in a single localStorage key as a bounded LRU map
 * (max 100 sessions). Only collapsed turn IDs are stored since expanded is
 * the default for thinking/activity content.
 *
 * Shape: { [sessionId]: { collapsedTurns: string[], groups: string[], lastAccessed: number } }
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import * as storage from '@/lib/local-storage'

const MAX_SESSIONS = 100

/** Entry for a single session's expansion state */
export interface ExpansionEntry {
  /** Legacy expanded-only field from the old collapsed-by-default model. */
  turns?: string[]
  collapsedTurns?: string[]
  groups: string[]
  lastAccessed: number
}

/** Full map stored in localStorage */
type ExpansionMap = Record<string, ExpansionEntry>

export function readCollapsedTurns(entry: ExpansionEntry | undefined): Set<string> {
  return new Set(entry?.collapsedTurns ?? [])
}

export function isTurnExpandedByDefault(turnId: string, collapsedTurns: Set<string>): boolean {
  return !collapsedTurns.has(turnId)
}

export function createTurnExpansionEntry(
  collapsedTurns: string[],
  groups: string[],
  lastAccessed = Date.now(),
): ExpansionEntry {
  return {
    collapsedTurns,
    groups,
    lastAccessed,
  }
}

export function createTurnExpansionState(entry: ExpansionEntry | undefined): {
  collapsedTurns: Set<string>
  expandedActivityGroups: Set<string>
} {
  return {
    collapsedTurns: readCollapsedTurns(entry),
    expandedActivityGroups: entry ? new Set(entry.groups) : new Set(),
  }
}

/**
 * Read the full expansion map from localStorage.
 * Returns empty object on parse failure.
 */
function readMap(): ExpansionMap {
  return storage.get<ExpansionMap>(storage.KEYS.turnCardExpansion, {})
}

/**
 * Write the expansion map to localStorage, pruning to MAX_SESSIONS
 * by dropping the oldest entries (lowest lastAccessed).
 */
function writeMap(map: ExpansionMap): void {
  const entries = Object.entries(map)
  if (entries.length > MAX_SESSIONS) {
    // Sort by lastAccessed ascending, keep only the most recent MAX_SESSIONS
    entries.sort((a, b) => a[1].lastAccessed - b[1].lastAccessed)
    const pruned: ExpansionMap = {}
    const keep = entries.slice(entries.length - MAX_SESSIONS)
    for (const [key, value] of keep) {
      pruned[key] = value
    }
    storage.set(storage.KEYS.turnCardExpansion, pruned)
  } else {
    storage.set(storage.KEYS.turnCardExpansion, map)
  }
}

/**
 * Persist TurnCard expansion state for the given session.
 * Returns controlled state + callbacks to pass to TurnCard components.
 */
export function useTurnCardExpansion(sessionId: string | undefined) {
  // Initialize state from localStorage for this session
  const [expansionState, setExpansionState] = useState(() => {
    if (!sessionId) return createTurnExpansionState(undefined)
    const map = readMap()
    return createTurnExpansionState(map[sessionId])
  })
  const { collapsedTurns, expandedActivityGroups } = expansionState

  // Track sessionId so we can save/restore on session switch
  const prevSessionIdRef = useRef(sessionId)

  // When sessionId changes, save current state and load new session's state
  useEffect(() => {
    if (prevSessionIdRef.current === sessionId) return

    // Load the new session's expansion state from localStorage
    if (sessionId) {
      const map = readMap()
      setExpansionState(createTurnExpansionState(map[sessionId]))
    } else {
      setExpansionState(createTurnExpansionState(undefined))
    }

    prevSessionIdRef.current = sessionId
  }, [sessionId])

  // Persist to localStorage whenever expansion state changes.
  // Uses a ref to avoid stale closures and only writes when we have a valid session.
  const collapsedTurnsRef = useRef(collapsedTurns)
  const expandedGroupsRef = useRef(expandedActivityGroups)
  collapsedTurnsRef.current = collapsedTurns
  expandedGroupsRef.current = expandedActivityGroups

  useEffect(() => {
    if (!sessionId) return
    const map = readMap()
    const turns = [...collapsedTurnsRef.current]
    const groups = [...expandedGroupsRef.current]

    // Only write an entry if the user changed the expanded-by-default state.
    if (turns.length === 0 && groups.length === 0) {
      if (map[sessionId]) {
        delete map[sessionId]
        writeMap(map)
      }
      return
    }

    map[sessionId] = createTurnExpansionEntry(turns, groups)
    writeMap(map)
  }, [sessionId, collapsedTurns, expandedActivityGroups])

  const isTurnExpanded = useCallback((turnId: string) => {
    return isTurnExpandedByDefault(turnId, collapsedTurnsRef.current)
  }, [])

  // Toggle a single turn's expansion state
  const toggleTurn = useCallback((turnId: string, expanded: boolean) => {
    setExpansionState(prev => {
      const next = new Set(prev.collapsedTurns)
      if (expanded) {
        next.delete(turnId)
      } else {
        next.add(turnId)
      }
      return { ...prev, collapsedTurns: next }
    })
  }, [])

  const setExpandedActivityGroups = useCallback((groups: Set<string>) => {
    setExpansionState(prev => ({ ...prev, expandedActivityGroups: groups }))
  }, [])

  return {
    isTurnExpanded,
    toggleTurn,
    expandedActivityGroups,
    setExpandedActivityGroups,
  }
}
