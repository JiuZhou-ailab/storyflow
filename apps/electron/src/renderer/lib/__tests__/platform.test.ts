import { describe, expect, it } from 'bun:test'
import { getDefaultColorThemeForPlatform, getPathBasename, getRendererPlatformName } from '../platform'

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

describe('getPathBasename', () => {
  it('reads folder names from Unix and Windows paths', () => {
    expect(getPathBasename('/Users/zjding/novels/九州/')).toBe('九州')
    expect(getPathBasename('D:\\写作项目\\九州')).toBe('九州')
  })
})
