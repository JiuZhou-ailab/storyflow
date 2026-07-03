// input: session-scoped option maps and partial option updates
// output: regression coverage for preserving option map references on no-op writes
// pos: guards App-level sessionOptions context state against unnecessary invalidation

import { describe, expect, it } from 'bun:test'
import {
  defaultSessionOptions,
  updateSessionOptionsMap,
  type SessionOptions,
} from '../useSessionOptions'

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
})
