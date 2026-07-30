// input: Active transport mode and directory picker target
// output: Regression coverage for local project directory selection
// pos: Protects the boundary between global project actions and workspace-scoped browsing

import { describe, expect, it } from 'bun:test'
import { shouldUseServerDirectoryPicker } from '../useDirectoryPicker'

describe('directory picker target', () => {
  it('keeps project-level folder selection on the local machine from a remote workspace', () => {
    expect(shouldUseServerDirectoryPicker('remote', 'local-machine')).toBe(false)
    expect(shouldUseServerDirectoryPicker('remote', 'active-workspace')).toBe(true)
    expect(shouldUseServerDirectoryPicker('local', 'active-workspace')).toBe(false)
  })
})
