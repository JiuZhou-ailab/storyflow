// input: Renderer permission and credential request queue updates
// output: Per-session pending request atoms for prompt rendering
// pos: Isolates pending prompt subscriptions from broad app shell context

import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'
import type { CredentialRequest, PermissionRequest } from '../../shared/types'

export const pendingPermissionsAtom = atom<Map<string, PermissionRequest[]>>(new Map())
export const pendingCredentialsAtom = atom<Map<string, CredentialRequest[]>>(new Map())

export const pendingPermissionAtomFamily = atomFamily(
  (sessionId: string) => atom((get) => get(pendingPermissionsAtom).get(sessionId)?.[0])
)

export const pendingCredentialAtomFamily = atomFamily(
  (sessionId: string) => atom((get) => get(pendingCredentialsAtom).get(sessionId)?.[0])
)

export const hasPendingPromptAtomFamily = atomFamily(
  (sessionId: string) => atom((get) => (get(pendingPermissionsAtom).get(sessionId)?.length ?? 0) > 0)
)
