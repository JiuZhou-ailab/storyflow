// input: Stable Project IDs and legacy mutable slugs
// output: URL workspace resolution compatibility checks
// pos: Regression coverage for relink-safe renderer navigation

import { describe, expect, it } from 'bun:test'
import { findWorkspaceByRouteKey } from './workspace-route'

describe('workspace route keys', () => {
  const workspaces = [{ id: 'project-stable', slug: 'old-folder' }]

  it('uses stable Project identity and still reads legacy slug URLs', () => {
    expect(findWorkspaceByRouteKey(workspaces, 'project-stable')?.id).toBe('project-stable')
    expect(findWorkspaceByRouteKey(workspaces, 'old-folder')?.id).toBe('project-stable')
  })

  it('does not activate a historical route whose Project root is unavailable', () => {
    expect(findWorkspaceByRouteKey([
      { id: 'removed-project', slug: 'removed-project', rootAvailable: false },
    ], 'removed-project')).toBeUndefined()
  })
})
