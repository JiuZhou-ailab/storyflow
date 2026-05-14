// input: Startup policy helpers
// output: Regression coverage for Electron startup window gating
// pos: Verifies main-process startup failures cannot create broken UI windows

import { describe, expect, it } from 'bun:test'
import { shouldCreateWindowsAfterStartup } from '../startup-state'

describe('shouldCreateWindowsAfterStartup', () => {
  it('blocks UI window creation after non-client startup failure', () => {
    expect(shouldCreateWindowsAfterStartup({
      initSucceeded: false,
      isHeadless: false,
    })).toBe(false)
  })

  it('allows UI window creation after successful desktop startup', () => {
    expect(shouldCreateWindowsAfterStartup({
      initSucceeded: true,
      isHeadless: false,
    })).toBe(true)
  })

  it('blocks UI window creation in headless mode', () => {
    expect(shouldCreateWindowsAfterStartup({
      initSucceeded: true,
      isHeadless: true,
    })).toBe(false)
  })
})
