// input: AppShellContext source and per-session pending request hooks
// output: Regression coverage for keeping pending request queues off broad context updates
// pos: Guards renderer pending prompt subscription boundaries

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import {
  pendingPermissionAtomFamily,
  pendingPermissionsAtom,
} from '../../atoms/pending-requests'
import { appendUniqueRequestForSession } from '../../lib/request-queue'
import type { PermissionRequest } from '../../../shared/types'

const appShellContextSource = readFileSync(new URL('../AppShellContext.tsx', import.meta.url), 'utf-8')

describe('pending request subscriptions', () => {
  it('keeps pending request queues out of AppShellContext', () => {
    expect(appShellContextSource).not.toContain('pendingPermissions: Map')
    expect(appShellContextSource).not.toContain('pendingCredentials: Map')
    expect(appShellContextSource).not.toContain('pendingPermissions.get(sessionId)')
    expect(appShellContextSource).not.toContain('pendingCredentials.get(sessionId)')
  })

  it('does not notify other sessions when one pending permission changes', () => {
    const store = createStore()
    const s2PermissionAtom = pendingPermissionAtomFamily('s2')
    let s2Notifications = 0
    const request: PermissionRequest = {
      requestId: 'req-1',
      sessionId: 's1',
      toolName: 'Bash',
      description: 'Run command',
      command: 'pwd',
    }

    expect(store.get(s2PermissionAtom)).toBeUndefined()
    const unsubscribe = store.sub(s2PermissionAtom, () => {
      s2Notifications++
    })

    store.set(
      pendingPermissionsAtom,
      appendUniqueRequestForSession(store.get(pendingPermissionsAtom), 's1', request)
    )

    unsubscribe()
    expect(store.get(pendingPermissionAtomFamily('s1'))).toBe(request)
    expect(store.get(s2PermissionAtom)).toBeUndefined()
    expect(s2Notifications).toBe(0)
  })
})
