// input: WorkspaceCreationScreen source
// output: Static regression coverage for returning from project creation to the project hub
// pos: Keeps project creation reversible when launched from project management

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../WorkspaceCreationScreen.tsx', import.meta.url), 'utf8')

describe('WorkspaceCreationScreen return affordance', () => {
  it('supports an explicit close label for returning to project management', () => {
    expect(source).toContain('closeLabel')
    expect(source).toContain('aria-label={closeLabel}')
    expect(source).toContain('{closeLabel}')
  })

  it('supports opening directly into create, import, or remote connection steps', () => {
    expect(source).toContain('initialStep')
    expect(source).toContain("export type WorkspaceCreationInitialStep")
    expect(source).toContain("reconnectWorkspace ? 'remote' : initialStep")
  })
})
