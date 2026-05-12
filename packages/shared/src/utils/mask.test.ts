import { describe, expect, it } from 'bun:test'
import { isMaskedCredential } from './mask.ts'

describe('isMaskedCredential', () => {
  it('detects bullet placeholders returned for editing credentials', () => {
    expect(isMaskedCredential('sk-ant-••••••••abcd')).toBe(true)
    expect(isMaskedCredential('••••••••')).toBe(true)
  })

  it('detects ASCII masked placeholders', () => {
    expect(isMaskedCredential('sk-ant-...abcd')).toBe(true)
    expect(isMaskedCredential('******')).toBe(true)
  })

  it('does not classify real credentials as masked', () => {
    expect(isMaskedCredential('sk-ant-real-key')).toBe(false)
    expect(isMaskedCredential(undefined)).toBe(false)
  })
})
