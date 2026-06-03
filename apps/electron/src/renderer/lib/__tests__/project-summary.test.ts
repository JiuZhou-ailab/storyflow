// input: Workspace records already loaded into the renderer
// output: ProjectHub summary projection behavior
// pos: Guards the pure Workspace-to-ProjectSummary adapter boundary

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { Workspace } from '../../../shared/types'
import { buildProjectSummaries } from '../project-summary'

type WorkspaceWithProjectMetadata = Workspace & {
  projectType?: 'general' | 'novel' | 'screenplay' | 'short-form'
  methodPackId?: string
}

function workspace(overrides: Partial<WorkspaceWithProjectMetadata> & Pick<Workspace, 'id' | 'name'>): Workspace {
  return {
    slug: overrides.id,
    rootPath: `/tmp/${overrides.id}`,
    createdAt: 1,
    ...overrides,
  } as Workspace
}

describe('buildProjectSummaries', () => {
  it('maps local and remote workspace status without changing order', () => {
    expect(buildProjectSummaries([
      workspace({ id: 'local-1', name: 'Local Novel' }),
      workspace({
        id: 'remote-1',
        name: 'Remote Novel',
        remoteServer: {
          url: 'wss://example.com',
          token: 'token',
          remoteWorkspaceId: 'remote-workspace-1',
        },
      }),
    ])).toEqual([
      {
        id: 'local-1',
        name: 'Local Novel',
        rootPath: '/tmp/local-1',
        kind: 'general',
        status: 'local',
      },
      {
        id: 'remote-1',
        name: 'Remote Novel',
        rootPath: '/tmp/remote-1',
        kind: 'general',
        status: 'remote',
      },
    ])
  })

  it('maps projectType to kind and falls back to general when missing', () => {
    expect(buildProjectSummaries([
      workspace({ id: 'novel-1', name: 'Novel', projectType: 'novel' }),
      workspace({ id: 'screenplay-1', name: 'Script', projectType: 'screenplay' }),
      workspace({ id: 'short-1', name: 'Short Form', projectType: 'short-form' }),
      workspace({ id: 'general-1', name: 'General' }),
    ]).map((summary) => summary.kind)).toEqual(['novel', 'screenplay', 'short-form', 'general'])
  })

  it('passes methodPackId through when the workspace carries one', () => {
    expect(buildProjectSummaries([
      workspace({
        id: 'novel-method-1',
        name: 'Novel Method',
        projectType: 'novel',
        methodPackId: 'novel.free-creation',
      }),
    ])[0]?.methodPackId).toBe('novel.free-creation')
  })

  it('projects lastAccessedAt as lastActivityAt when available', () => {
    expect(buildProjectSummaries([
      workspace({ id: 'recent-1', name: 'Recent', lastAccessedAt: 1710000000000 }),
    ])[0]?.lastActivityAt).toBe(1710000000000)
  })

  it('keeps missing local paths as local summaries without filesystem or electronAPI dependencies', () => {
    expect(buildProjectSummaries([
      workspace({
        id: 'missing-path-1',
        name: 'Missing Local Path',
        rootPath: '/definitely/missing/project-summary-boundary',
      }),
    ])[0]).toMatchObject({
      id: 'missing-path-1',
      rootPath: '/definitely/missing/project-summary-boundary',
      status: 'local',
    })

    const source = readFileSync(new URL('../project-summary.ts', import.meta.url), 'utf-8')
    expect(source).not.toContain('node:fs')
    expect(source).not.toContain("from 'fs'")
    expect(source).not.toContain('electronAPI')
  })
})
