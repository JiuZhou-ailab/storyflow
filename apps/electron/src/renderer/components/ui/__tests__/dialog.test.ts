// input: Dialog size scale constants
// output: Contract tests for semantic max-width mapping
// pos: Guards P0 dialog chrome against accidental size drift

import { describe, expect, it } from 'bun:test'
import { DIALOG_SIZE_CLASS, type DialogSize } from '../dialog'

describe('DIALOG_SIZE_CLASS', () => {
  it('covers every semantic size with a stable max-width class', () => {
    const sizes: DialogSize[] = ['sm', 'md', 'lg', 'xl']
    for (const size of sizes) {
      expect(DIALOG_SIZE_CLASS[size]).toMatch(/^sm:max-w-/)
    }
  })

  it('keeps lg as the historical default width token', () => {
    // Pre-P0 DialogContent used sm:max-w-lg as the default
    expect(DIALOG_SIZE_CLASS.lg).toBe('sm:max-w-lg')
  })

  it('orders sizes from narrow to wide by tailwind token', () => {
    expect(DIALOG_SIZE_CLASS.sm).toBe('sm:max-w-sm')
    expect(DIALOG_SIZE_CLASS.md).toBe('sm:max-w-md')
    expect(DIALOG_SIZE_CLASS.lg).toBe('sm:max-w-lg')
    expect(DIALOG_SIZE_CLASS.xl).toBe('sm:max-w-xl')
  })
})
