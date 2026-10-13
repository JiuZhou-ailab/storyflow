import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Workspace } from '@craft-agent/core/types'
import { getWorkspaceRootUnavailableReason } from '../project-registry.ts'
import { getWorkspaceConfigPath } from '../paths.ts'

const roots: string[] = []

function createProject(directoryConfigId = 'directory-1'): { parent: string; workspace: Workspace } {
  const parent = mkdtempSync(join(tmpdir(), 'storyflow-root-availability-'))
  roots.push(parent)
  const rootPath = join(parent, 'project')
  const configPath = getWorkspaceConfigPath(rootPath)
  mkdirSync(join(configPath, '..'), { recursive: true })
  writeFileSync(configPath, JSON.stringify({ id: 'directory-1', name: 'Novel', slug: 'novel', createdAt: 1, updatedAt: 1 }))
  return {
    parent,
    workspace: { id: 'project-1', name: 'Novel', slug: 'novel', rootPath, createdAt: 1, directoryConfigId } as Workspace,
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('getWorkspaceRootUnavailableReason', () => {
  it('reports nothing for an intact Project folder', () => {
    expect(getWorkspaceRootUnavailableReason(createProject().workspace)).toBeNull()
  })

  it('reports a moved, renamed, or deleted Project folder as missing', () => {
    const { parent, workspace } = createProject()
    renameSync(workspace.rootPath, join(parent, 'renamed'))
    expect(getWorkspaceRootUnavailableReason(workspace)).toBe('missing')
  })

  it('reports a different folder at the registered path as a mismatch', () => {
    expect(getWorkspaceRootUnavailableReason(createProject('directory-other').workspace)).toBe('mismatch')
  })

  it('reports an existing folder without Project state as a mismatch', () => {
    const { workspace } = createProject()
    rmSync(join(getWorkspaceConfigPath(workspace.rootPath), '..'), { recursive: true, force: true })
    expect(getWorkspaceRootUnavailableReason(workspace)).toBe('mismatch')
  })

  it('never reports remote Projects as unavailable', () => {
    const { parent, workspace } = createProject()
    rmSync(parent, { recursive: true, force: true })
    expect(getWorkspaceRootUnavailableReason({ ...workspace, remoteServer: { url: 'wss://host', credentialRef: 'remote_server_token::project-1', remoteWorkspaceId: 'remote-1' } } as Workspace)).toBeNull()
  })
})
