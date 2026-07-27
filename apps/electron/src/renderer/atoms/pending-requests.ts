// input: Renderer permission and credential request queue updates
// output: Per-session pending request atoms for prompt rendering
// pos: Isolates pending prompt subscriptions from broad app shell context

import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'
import type { CredentialRequest, PermissionRequest, UserQuestionRequest } from '../../shared/types'

export const pendingPermissionsAtom = atom<Map<string, PermissionRequest[]>>(new Map())
export const pendingCredentialsAtom = atom<Map<string, CredentialRequest[]>>(new Map())
export const pendingUserQuestionsAtom = atom<Map<string, UserQuestionRequest[]>>(new Map())

export const pendingPermissionAtomFamily = atomFamily(
  (sessionId: string) => atom((get) => get(pendingPermissionsAtom).get(sessionId)?.[0])
)

export const pendingCredentialAtomFamily = atomFamily(
  (sessionId: string) => atom((get) => get(pendingCredentialsAtom).get(sessionId)?.[0])
)

export const pendingUserQuestionAtomFamily = atomFamily(
  (sessionId: string) => atom((get) => get(pendingUserQuestionsAtom).get(sessionId)?.[0])
)

/**
 * Session ids with any outstanding prompt.
 *
 * Aggregate views (collapsed groups, rails) need to answer "does anything in
 * here need me?" without subscribing per session, which a `atomFamily` lookup
 * inside a render loop cannot do.
 */
export const sessionIdsWithPendingPromptAtom = atom((get) => {
  const ids = new Set<string>()
  for (const [sessionId, requests] of get(pendingPermissionsAtom)) {
    if (requests.length > 0) ids.add(sessionId)
  }
  for (const [sessionId, requests] of get(pendingCredentialsAtom)) {
    if (requests.length > 0) ids.add(sessionId)
  }
  for (const [sessionId, requests] of get(pendingUserQuestionsAtom)) {
    if (requests.length > 0) ids.add(sessionId)
  }
  return ids
})

/**
 * Whether the session is blocked on any human response.
 *
 * Covers credentials as well as permissions: both stop the turn until someone
 * answers, so treating only permissions as "pending" left credential-blocked
 * sessions indistinguishable from healthy ones.
 */
export const hasPendingPromptAtomFamily = atomFamily(
  (sessionId: string) => atom((get) => (
    (get(pendingPermissionsAtom).get(sessionId)?.length ?? 0) > 0
    || (get(pendingCredentialsAtom).get(sessionId)?.length ?? 0) > 0
    || (get(pendingUserQuestionsAtom).get(sessionId)?.length ?? 0) > 0
  ))
)
