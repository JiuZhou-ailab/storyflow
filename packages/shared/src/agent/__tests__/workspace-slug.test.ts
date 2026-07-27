// input: Workspace paths and fallback IDs
// output: Regression proof for browser-safe workspace slug extraction
// pos: Small utility contract independent of global Skill identity

import { describe, expect, it } from 'bun:test'

import { extractWorkspaceSlugFromPath } from '../../utils/workspace.ts'

describe('workspace slug extraction', () => {
  it('extracts the final path segment across platforms', () => {
    expect(extractWorkspaceSlugFromPath('/Users/foo/my-workspace', 'fallback')).toBe('my-workspace')
    expect(extractWorkspaceSlugFromPath('C:\\Users\\foo\\my-workspace', 'fallback')).toBe('my-workspace')
  })

  it('uses the fallback when the path has no segment', () => {
    expect(extractWorkspaceSlugFromPath('/', 'fallback')).toBe('fallback')
    expect(extractWorkspaceSlugFromPath('', 'fallback')).toBe('fallback')
  })
})
