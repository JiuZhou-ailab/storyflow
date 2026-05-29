// input: Stored workspace list at desktop startup
// output: Workspace id passed to the first BrowserWindow
// pos: Prevents first-run startup from silently creating a default project

import { describe, expect, it } from 'bun:test'
import { resolveStartupWindowWorkspaceId } from '../startup-window'

describe('resolveStartupWindowWorkspaceId', () => {
  it('returns an empty workspace id when no projects exist yet', () => {
    expect(resolveStartupWindowWorkspaceId([])).toBe('')
  })

  it('returns the first workspace id for existing users', () => {
    expect(resolveStartupWindowWorkspaceId([{ id: 'workspace-1' }])).toBe('workspace-1')
  })
})
