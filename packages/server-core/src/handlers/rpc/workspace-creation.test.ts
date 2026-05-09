import { describe, expect, it } from 'bun:test'
import {
  ensureWorkspaceRootForProject,
  normalizeCreateWorkspaceOptions,
} from './workspace-creation'

describe('normalizeCreateWorkspaceOptions', () => {
  it('keeps legacy remoteServer argument while accepting projectType as a fourth argument', () => {
    const remoteServer = {
      url: 'ws://localhost:9100',
      token: 'token',
      remoteWorkspaceId: 'remote-ws',
    }

    expect(normalizeCreateWorkspaceOptions(remoteServer, 'novel')).toEqual({
      remoteServer,
      projectType: 'novel',
    })
  })

  it('accepts the new creation options payload', () => {
    const options = {
      projectType: 'novel' as const,
      remoteServer: {
        url: 'ws://localhost:9100',
        token: 'token',
        remoteWorkspaceId: 'remote-ws',
      },
    }

    expect(normalizeCreateWorkspaceOptions(options)).toBe(options)
  })
})

describe('ensureWorkspaceRootForProject', () => {
  it('creates the novel scaffold only for novel workspaces missing a workspace config', () => {
    const created: Array<{ rootPath: string; name: string }> = []

    ensureWorkspaceRootForProject('/tmp/book', 'Book', 'novel', {
      isValidWorkspace: () => false,
      createNovelWorkspaceAtPath: (rootPath, name) => {
        created.push({ rootPath, name })
      },
    })

    expect(created).toEqual([{ rootPath: '/tmp/book', name: 'Book' }])
  })

  it('leaves general workspace creation to the existing addWorkspace path', () => {
    const created: Array<{ rootPath: string; name: string }> = []

    ensureWorkspaceRootForProject('/tmp/general', 'General', 'general', {
      isValidWorkspace: () => false,
      createNovelWorkspaceAtPath: (rootPath, name) => {
        created.push({ rootPath, name })
      },
    })

    expect(created).toEqual([])
  })

  it('does not overwrite an existing workspace config', () => {
    const created: Array<{ rootPath: string; name: string }> = []

    ensureWorkspaceRootForProject('/tmp/book', 'Book', 'novel', {
      isValidWorkspace: () => true,
      createNovelWorkspaceAtPath: (rootPath, name) => {
        created.push({ rootPath, name })
      },
    })

    expect(created).toEqual([])
  })
})
