// input: Session-list search UI state from the app shell navigator.
// output: Shared atoms for chat transcript highlighting driven by session-list search.
// pos: Narrow renderer state bridge between AppShell's navigator controls and ChatPage.

import { atom } from 'jotai'

export const sessionListSearchActiveAtom = atom(false)
export const sessionListSearchQueryAtom = atom('')

export const activeSessionListSearchQueryAtom = atom((get) => {
  return get(sessionListSearchActiveAtom) ? get(sessionListSearchQueryAtom) : undefined
})
