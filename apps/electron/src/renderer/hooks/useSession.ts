// input: Session selection atoms and renderer session metadata atoms
// output: Session selection hooks and selected-session metadata selectors
// pos: Narrow selection boundary for session list and batch action surfaces

import { useCallback, useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import { createInitialState, singleSelect } from './useMultiSelect'
import { sessionSelection } from './useEntitySelection'

function sameSessionMetas(a: SessionMeta[], b: SessionMeta[]): boolean {
  return a.length === b.length && a.every((meta, index) => meta === b[index])
}

/**
 * Legacy type alias for backward compatibility
 */
type Config = {
  selected: string | null
}

/**
 * Legacy hook - maintains backward compatibility with existing code.
 * Returns [{ selected }, setSession] tuple.
 *
 * @deprecated Use useSessionSelection() for full multi-select support
 */
export function useSession(): [Config, (config: Config) => void] {
  const { state, setState } = sessionSelection.useSelectionStore()

  const legacySetSession = useCallback((config: Config) => {
    if (config.selected === null) {
      setState(createInitialState())
    } else {
      setState(singleSelect(config.selected, -1))
    }
  }, [setState])

  return [{ selected: state.selected }, legacySetSession]
}

// Re-export factory-generated hooks under existing names
export const useSessionSelection = sessionSelection.useSelection
export const useSessionSelectionStore = sessionSelection.useSelectionStore
export const useIsMultiSelectActive = sessionSelection.useIsMultiSelectActive
export const useSelectedIds = sessionSelection.useSelectedIds
export const useSelectionCount = sessionSelection.useSelectionCount

export function useSelectedSessionMetas(): SessionMeta[] {
  const selectedIds = useSelectedIds()
  const selectedMetasAtom = useMemo(
    () => selectAtom(
      sessionMetaMapAtom,
      (metaMap) => {
        const metas: SessionMeta[] = []
        selectedIds.forEach((id) => {
          const meta = metaMap.get(id)
          if (meta) metas.push(meta)
        })
        return metas
      },
      sameSessionMetas,
    ),
    [selectedIds],
  )
  return useAtomValue(selectedMetasAtom)
}
