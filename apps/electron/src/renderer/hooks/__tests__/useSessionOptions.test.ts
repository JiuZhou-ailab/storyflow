// input: session-scoped option maps and partial option updates
// output: regression coverage for preserving option map references on no-op writes
// pos: guards App-level sessionOptions context state against unnecessary invalidation

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'
import {
  defaultSessionOptions,
  updateSessionOptionsMap,
  type SessionOptions,
} from '../useSessionOptions'

const appSource = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf-8')

describe('updateSessionOptionsMap', () => {
  it('keeps the original map when default options are not stored', () => {
    const options = new Map<string, SessionOptions>()

    expect(updateSessionOptionsMap(options, 's1', defaultSessionOptions)).toBe(options)
  })

  it('keeps the original map when stored options are unchanged', () => {
    const current = { ...defaultSessionOptions, permissionMode: 'allow-all' as const }
    const options = new Map<string, SessionOptions>([['s1', current]])

    expect(updateSessionOptionsMap(options, 's1', { permissionMode: 'allow-all' })).toBe(options)
  })

  it('stores non-default options', () => {
    const options = new Map<string, SessionOptions>()
    const next = updateSessionOptionsMap(options, 's1', { permissionMode: 'allow-all' })

    expect(next).not.toBe(options)
    expect(next.get('s1')?.permissionMode).toBe('allow-all')
  })

  it('deletes stored options when they return to defaults', () => {
    const options = new Map<string, SessionOptions>([
      ['s1', { ...defaultSessionOptions, permissionMode: 'allow-all' }],
    ])
    const next = updateSessionOptionsMap(options, 's1', { permissionMode: defaultSessionOptions.permissionMode })

    expect(next).not.toBe(options)
    expect(next.has('s1')).toBe(false)
  })

  it('does not rebuild message sending when unrelated session options change', () => {
    const sendMessageSource = appSource.slice(
      appSource.indexOf('const handleSendMessage = useCallback'),
      appSource.indexOf('const handleSessionOptionsChange')
    )

    expect(sendMessageSource).toContain('}, [updateSessionById, skills, sources, windowWorkspaceId])')
    expect(sendMessageSource).not.toContain('}, [sessionOptions, updateSessionById')
  })
})
