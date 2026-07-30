// input: WorkspaceCreationScreen source
// output: Static regression coverage for local creation and remote recovery separation
// pos: Keeps remote imports out of normal project creation without removing reconnect

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../WorkspaceCreationScreen.tsx', import.meta.url), 'utf8')

describe('WorkspaceCreationScreen return affordance', () => {
  it('supports an explicit close label for returning to project management', () => {
    expect(source).toContain('closeLabel')
    expect(source).toContain('aria-label={closeLabel}')
    expect(source).toContain('{closeLabel}')
  })

  it('shows local creation normally and remote connection only for reconnect', () => {
    expect(source).toContain('reconnectWorkspace?.remoteServer ?')
    expect(source).toContain('<AddWorkspaceStep_CreateNew')
    expect(source).toContain('<AddWorkspaceStep_ConnectRemote')
    expect(source).not.toContain('AddWorkspaceStep_Choice')
    expect(source).not.toContain('AddWorkspaceStep_OpenFolder')
    expect(source).not.toContain('initialStep')
  })
})
