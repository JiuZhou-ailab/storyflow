import { describe, expect, it } from 'bun:test'
import { getDefaultColorThemeForPlatform, getRendererPlatformName } from '../platform'

describe('getRendererPlatformName', () => {
  it('normalizes Windows navigator platforms to win32', () => {
    expect(getRendererPlatformName('Win32')).toBe('win32')
    expect(getRendererPlatformName('Windows')).toBe('win32')
  })

  it('normalizes macOS and Linux navigator platforms', () => {
    expect(getRendererPlatformName('MacIntel')).toBe('darwin')
    expect(getRendererPlatformName('Linux x86_64')).toBe('linux')
  })

  it('falls back to other for unknown platforms', () => {
    expect(getRendererPlatformName('FreeBSD')).toBe('other')
    expect(getRendererPlatformName(undefined)).toBe('other')
  })
})

describe('getDefaultColorThemeForPlatform', () => {
  it('uses a neutral preset as the Windows default theme', () => {
    expect(getDefaultColorThemeForPlatform('win32')).toBe('github')
  })

  it('keeps the existing default theme on non-Windows platforms', () => {
    expect(getDefaultColorThemeForPlatform('darwin')).toBe('default')
    expect(getDefaultColorThemeForPlatform('linux')).toBe('default')
    expect(getDefaultColorThemeForPlatform('other')).toBe('default')
  })
})
