// input: Workspace creation RPC normalization and project root scaffolding helpers
// output: Regression tests for Method Pack option propagation
// pos: Server-core guard for new workspace creation behavior

import { describe, expect, it } from 'bun:test'
import {
  ensureWorkspaceRootForProject,
  normalizeCreateWorkspaceOptions,
} from './workspace-creation'
import { getBuiltInMethodPacks } from '@craft-agent/shared/writing/method-packs'

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
      methodPackId: 'novel.claude-book',
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

    expect(normalizeCreateWorkspaceOptions(options)).toEqual({
      ...options,
      methodPackId: 'novel.claude-book',
    })
  })

  it('preserves explicit method pack ids', () => {
    expect(normalizeCreateWorkspaceOptions({
      methodPackId: 'novel.claude-book',
    })).toEqual({
      methodPackId: 'novel.claude-book',
    })
  })

  it('preserves explicit non-default novel method pack ids', () => {
    expect(normalizeCreateWorkspaceOptions({
      projectType: 'novel',
      methodPackId: 'novel.oh-story',
    })).toEqual({
      projectType: 'novel',
      methodPackId: 'novel.oh-story',
    })
  })

  it('preserves explicit short-form method pack ids', () => {
    expect(normalizeCreateWorkspaceOptions({
      projectType: 'short-form',
      methodPackId: 'short-form.article',
    })).toEqual({
      projectType: 'short-form',
      methodPackId: 'short-form.article',
    })
  })
})

describe('ensureWorkspaceRootForProject', () => {
  it('creates the novel scaffold only for novel workspaces missing a workspace config', () => {
    const created: Array<{ rootPath: string; name: string; methodPackId?: string }> = []

    ensureWorkspaceRootForProject('/tmp/book', 'Book', { projectType: 'novel' }, {
      isValidWorkspace: () => false,
      createNovelWorkspaceAtPath: (rootPath, name, methodPackId) => {
        created.push({ rootPath, name, methodPackId })
      },
    })

    expect(created).toEqual([{ rootPath: '/tmp/book', name: 'Book', methodPackId: 'novel.claude-book' }])
  })

  it('leaves general workspace creation to the existing addWorkspace path', () => {
    const created: Array<{ rootPath: string; name: string; methodPackId?: string }> = []

    ensureWorkspaceRootForProject('/tmp/general', 'General', { projectType: 'general' }, {
      isValidWorkspace: () => false,
      createNovelWorkspaceAtPath: (rootPath, name, methodPackId) => {
        created.push({ rootPath, name, methodPackId })
      },
    })

    expect(created).toEqual([])
  })

  it('does not overwrite an existing workspace config', () => {
    const created: Array<{ rootPath: string; name: string; methodPackId?: string }> = []

    ensureWorkspaceRootForProject('/tmp/book', 'Book', { projectType: 'novel' }, {
      isValidWorkspace: () => true,
      createNovelWorkspaceAtPath: (rootPath, name, methodPackId) => {
        created.push({ rootPath, name, methodPackId })
      },
    })

    expect(created).toEqual([])
  })

  it('creates the novel scaffold for each explicit built-in method pack', () => {
    for (const methodPack of getBuiltInMethodPacks()) {
      const created: Array<{ rootPath: string; name: string; methodPackId?: string }> = []

      ensureWorkspaceRootForProject('/tmp/book', 'Book', { methodPackId: methodPack.id }, {
        isValidWorkspace: () => false,
        createNovelWorkspaceAtPath: (rootPath, name, methodPackId) => {
          created.push({ rootPath, name, methodPackId })
        },
      })

      expect(created).toEqual([{ rootPath: '/tmp/book', name: 'Book', methodPackId: methodPack.id }])
    }
  })

  it('rejects unknown method packs', () => {
    expect(() => ensureWorkspaceRootForProject(
      '/tmp/book',
      'Book',
      { methodPackId: 'unknown' as 'novel.claude-book' },
      {
        isValidWorkspace: () => false,
        createNovelWorkspaceAtPath: () => {},
      },
    )).toThrow('Unknown method pack')
  })
})
