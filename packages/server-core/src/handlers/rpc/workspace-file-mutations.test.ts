// input: Temporary workspace trees and registered workspace mutation RPC handlers
// output: Safety and behavior regression coverage for move, rename, and recursive delete
// pos: Contract tests for Finder-style file tree mutations at the server boundary

import { existsSync, rmSync, symlinkSync, unlinkSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, mock } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

let workspaceRootPath = ''

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (id: string) => id === 'workspace-1'
    ? {
        id,
        name: 'Workspace',
        rootPath: workspaceRootPath,
        slug: 'workspace',
      }
    : null,
}))

const {
  registerWorkspaceFileMutationHandlers,
  WORKSPACE_FILE_MUTATION_CHANNELS,
} = await import('./workspace-file-mutations')

function createHarness(workspaceId: string | null = 'workspace-1') {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    push() {},
    async invokeClient() {
      return undefined
    },
  }
  const deps: HandlerDeps = {
    sessionManager: {
      notifyConfigFileChange: () => {},
      withProjectLifecycle: async <T>(_projectId: string, work: () => Promise<T>): Promise<T> => work(),
    } as unknown as HandlerDeps['sessionManager'],
    resolveRuntimeWorkspace: (id: string) => id === 'workspace-1'
      ? {
          id,
          name: 'Workspace',
          rootPath: workspaceRootPath,
          slug: 'workspace',
          createdAt: 0,
        }
      : null,
    oauthFlowStore: {} as HandlerDeps['oauthFlowStore'],
    platform: {
      appRootPath: '/',
      resourcesPath: '/',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
      imageProcessor: {
        getMetadata: async () => null,
        process: async () => Buffer.from(''),
      },
    },
  }
  registerWorkspaceFileMutationHandlers(server, deps)

  const moveEntry = handlers.get(RPC_CHANNELS.file.MOVE_ENTRY)
  const deleteEntry = handlers.get(RPC_CHANNELS.file.DELETE_ENTRY)
  if (!moveEntry || !deleteEntry) throw new Error('workspace file mutation handlers not registered')

  const ctx: RequestContext = {
    clientId: 'client-1',
    workspaceId,
    webContentsId: 1,
  }
  return { moveEntry, deleteEntry, ctx }
}

describe('workspace file mutation RPCs', () => {
  it('registers dedicated move and delete entry channels', () => {
    expect(WORKSPACE_FILE_MUTATION_CHANNELS).toEqual([
      'file:moveEntry',
      'file:deleteEntry',
    ])
  })

  it('renames and moves entries atomically inside the active workspace', async () => {
    workspaceRootPath = await mkdtemp(join(tmpdir(), 'craft-tree-move-'))
    const sourceDirectory = join(workspaceRootPath, '正文')
    const destinationDirectory = join(workspaceRootPath, '归档')
    const sourcePath = join(sourceDirectory, '第一章.md')
    const destinationPath = join(destinationDirectory, '序章.md')
    const { moveEntry, ctx } = createHarness()

    try {
      await mkdir(sourceDirectory)
      await mkdir(destinationDirectory)
      await writeFile(sourcePath, 'chapter')

      const result = await moveEntry(ctx, {
        sourcePath,
        destinationDirectoryPath: destinationDirectory,
        newName: '序章.md',
      })

      expect(result).toEqual({ sourcePath, destinationPath, type: 'file' })
      expect(existsSync(sourcePath)).toBe(false)
      expect(await readFile(destinationPath, 'utf8')).toBe('chapter')
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true })
      workspaceRootPath = ''
    }
  })

  it('rejects collisions, invalid names, descendant moves, and symlink escape paths', async () => {
    workspaceRootPath = await mkdtemp(join(tmpdir(), 'craft-tree-guard-'))
    const outsideRoot = await mkdtemp(join(tmpdir(), 'craft-tree-outside-'))
    const sourceDirectory = join(workspaceRootPath, '正文')
    const childDirectory = join(sourceDirectory, '分卷')
    const destinationDirectory = join(workspaceRootPath, '归档')
    const sourcePath = join(sourceDirectory, '第一章.md')
    const collisionPath = join(destinationDirectory, '第一章.md')
    const outsideLink = join(workspaceRootPath, '外部')
    const { moveEntry, ctx } = createHarness()

    try {
      await mkdir(childDirectory, { recursive: true })
      await mkdir(destinationDirectory)
      await writeFile(sourcePath, 'source')
      await writeFile(collisionPath, 'collision')
      await symlink(outsideRoot, outsideLink, 'dir')

      await expect(moveEntry(ctx, {
        sourcePath,
        destinationDirectoryPath: destinationDirectory,
      })).rejects.toThrow('already exists')
      await expect(moveEntry(ctx, {
        sourcePath,
        destinationDirectoryPath: destinationDirectory,
        newName: '../escape.md',
      })).rejects.toThrow('single valid path segment')
      await expect(moveEntry(ctx, {
        sourcePath: sourceDirectory,
        destinationDirectoryPath: childDirectory,
      })).rejects.toThrow('cannot be moved into itself')
      await expect(moveEntry(ctx, {
        sourcePath,
        destinationDirectoryPath: outsideLink,
      })).rejects.toThrow('outside current workspace')
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true })
      rmSync(outsideRoot, { recursive: true, force: true })
      workspaceRootPath = ''
    }
  })

  it('requires explicit recursive deletion and always protects the workspace root', async () => {
    workspaceRootPath = await mkdtemp(join(tmpdir(), 'craft-tree-delete-'))
    const directoryPath = join(workspaceRootPath, '自由区')
    const filePath = join(directoryPath, '灵感.md')
    const { deleteEntry, ctx } = createHarness()

    try {
      await mkdir(directoryPath)
      await writeFile(filePath, 'idea')

      await expect(deleteEntry(ctx, { path: directoryPath })).rejects.toThrow()
      expect(existsSync(filePath)).toBe(true)

      expect(await deleteEntry(ctx, { path: directoryPath, recursive: true })).toEqual({
        path: directoryPath,
        type: 'directory',
      })
      expect(existsSync(directoryPath)).toBe(false)
      await expect(deleteEntry(ctx, { path: workspaceRootPath, recursive: true })).rejects.toThrow('Workspace root')
      expect(existsSync(workspaceRootPath)).toBe(true)
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true })
      workspaceRootPath = ''
    }
  })

  it('protects a symlinked workspace root when move targets its realpath alias', async () => {
    const workspaceContainer = await mkdtemp(join(tmpdir(), 'craft-tree-root-alias-move-'))
    const realWorkspaceRoot = join(workspaceContainer, 'real-workspace')
    workspaceRootPath = join(workspaceContainer, 'workspace-link')

    try {
      await mkdir(realWorkspaceRoot)
      await symlink(realWorkspaceRoot, workspaceRootPath, 'dir')
      const canonicalRoot = await realpath(workspaceRootPath)
      const destinationDirectory = join(canonicalRoot, '归档')
      await mkdir(destinationDirectory)
      const { moveEntry, ctx } = createHarness()

      await expect(moveEntry(ctx, {
        sourcePath: canonicalRoot,
        destinationDirectoryPath: destinationDirectory,
      })).rejects.toThrow('Workspace root')
      expect(existsSync(canonicalRoot)).toBe(true)
    } finally {
      rmSync(workspaceContainer, { recursive: true, force: true })
      workspaceRootPath = ''
    }
  })

  it('protects a symlinked workspace root when delete targets its realpath alias', async () => {
    const workspaceContainer = await mkdtemp(join(tmpdir(), 'craft-tree-root-alias-delete-'))
    const realWorkspaceRoot = join(workspaceContainer, 'real-workspace')
    workspaceRootPath = join(workspaceContainer, 'workspace-link')

    try {
      await mkdir(realWorkspaceRoot)
      await symlink(realWorkspaceRoot, workspaceRootPath, 'dir')
      const canonicalRoot = await realpath(workspaceRootPath)
      const { deleteEntry, ctx } = createHarness()

      await expect(deleteEntry(ctx, {
        path: canonicalRoot,
        recursive: true,
      })).rejects.toThrow('Workspace root')
      expect(existsSync(canonicalRoot)).toBe(true)
    } finally {
      rmSync(workspaceContainer, { recursive: true, force: true })
      workspaceRootPath = ''
    }
  })

  it('rejects a move when a validated source ancestor is rebound outside the workspace', async () => {
    workspaceRootPath = await mkdtemp(join(tmpdir(), 'craft-tree-rebind-'))
    const outsideRoot = await mkdtemp(join(tmpdir(), 'craft-tree-rebind-outside-'))
    const insideSourceDirectory = join(workspaceRootPath, 'inside-source')
    const sourceAlias = join(workspaceRootPath, 'source-alias')
    const sourcePath = join(sourceAlias, 'chapter.md')
    const outsideSourcePath = join(outsideRoot, 'chapter.md')
    const destinationDirectory = join(workspaceRootPath, 'destination')
    const { moveEntry, ctx } = createHarness()

    try {
      await mkdir(insideSourceDirectory)
      await mkdir(destinationDirectory)
      await writeFile(join(insideSourceDirectory, 'chapter.md'), 'inside')
      await writeFile(outsideSourcePath, 'outside')
      await symlink(insideSourceDirectory, sourceAlias, 'dir')

      await expect(moveEntry(ctx, {
        sourcePath,
        destinationDirectoryPath: destinationDirectory,
        get newName() {
          unlinkSync(sourceAlias)
          symlinkSync(outsideRoot, sourceAlias, 'dir')
          return 'moved.md'
        },
      })).rejects.toThrow('outside current workspace')

      expect(await readFile(outsideSourcePath, 'utf8')).toBe('outside')
      expect(existsSync(join(destinationDirectory, 'moved.md'))).toBe(false)
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true })
      rmSync(outsideRoot, { recursive: true, force: true })
      workspaceRootPath = ''
    }
  })

  it('fails closed when no active workspace context is available', async () => {
    workspaceRootPath = await mkdtemp(join(tmpdir(), 'craft-tree-context-'))
    const sourcePath = join(workspaceRootPath, '正文.md')
    const { moveEntry, deleteEntry, ctx } = createHarness(null)

    try {
      await writeFile(sourcePath, 'chapter')
      await expect(moveEntry(ctx, {
        sourcePath,
        destinationDirectoryPath: workspaceRootPath,
        newName: '重命名.md',
      })).rejects.toThrow('Workspace context is required')
      await expect(deleteEntry(ctx, { path: sourcePath })).rejects.toThrow('Workspace context is required')
      expect(existsSync(sourcePath)).toBe(true)
    } finally {
      rmSync(workspaceRootPath, { recursive: true, force: true })
      workspaceRootPath = ''
    }
  })
})
