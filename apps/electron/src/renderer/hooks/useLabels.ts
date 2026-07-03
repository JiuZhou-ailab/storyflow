/**
 * useLabels Hook
 *
 * React hook to load and manage workspace labels.
 * Returns the label tree (nested structure with children) from config.
 * Also exposes a flattened version for components that need flat lookups.
 * Auto-refreshes when workspace changes or label config changes.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import type { LabelConfig } from '@craft-agent/shared/labels'
import { flattenLabels } from '@craft-agent/shared/labels'

export interface UseLabelsResult {
  /** Label tree (root-level nodes with nested children) */
  labels: LabelConfig[]
  /** Flattened label list for lookups and non-hierarchical display */
  flatLabels: LabelConfig[]
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
}

function sameColor(a: LabelConfig['color'], b: LabelConfig['color']): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  return a.light === b.light && a.dark === b.dark
}

function sameAutoRules(a: LabelConfig['autoRules'], b: LabelConfig['autoRules']): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((rule, index) => {
    const next = b[index]
    return !!next
      && rule.pattern === next.pattern
      && rule.flags === next.flags
      && rule.valueTemplate === next.valueTemplate
      && rule.description === next.description
  })
}

export function areLabelTreesEqual(a: LabelConfig[], b: LabelConfig[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((label, index) => {
    const next = b[index]
    return !!next
      && label.id === next.id
      && label.name === next.name
      && label.valueType === next.valueType
      && sameColor(label.color, next.color)
      && sameAutoRules(label.autoRules, next.autoRules)
      && areLabelTreesEqual(label.children ?? [], next.children ?? [])
  })
}

/**
 * Load labels for a workspace via IPC.
 * Returns the tree structure (labels with nested children).
 * Auto-refreshes when workspaceId changes.
 * Subscribes to live label config changes via LABELS_CHANGED event.
 */
export function useLabels(workspaceId: string | null): UseLabelsResult {
  const [labels, setLabels] = useState<LabelConfig[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Memoized flat version of the tree for lookups
  const flatLabels = useMemo(() => flattenLabels(labels), [labels])

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setLabels(prev => prev.length === 0 ? prev : [])
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      const configs = await window.electronAPI.listLabels(workspaceId)
      setLabels(prev => areLabelTreesEqual(prev, configs) ? prev : configs)
      setError(null)
    } catch (err) {
      console.error('[useLabels] Failed to load labels:', err)
      setError(err instanceof Error ? err.message : 'Failed to load labels')
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  // Load labels when workspace changes
  useEffect(() => {
    refresh()
  }, [refresh])

  // Subscribe to live label changes (config file changes)
  useEffect(() => {
    if (!workspaceId) return

    const cleanup = window.electronAPI.onLabelsChanged((changedWorkspaceId) => {
      // Only refresh if this is our workspace
      if (changedWorkspaceId === workspaceId) {
        refresh()
      }
    })

    return cleanup
  }, [workspaceId, refresh])

  return {
    labels,
    flatLabels,
    isLoading,
    error,
    refresh,
  }
}
