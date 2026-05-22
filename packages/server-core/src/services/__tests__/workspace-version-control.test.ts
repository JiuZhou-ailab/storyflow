import { mkdtemp, readFile, realpath, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, it } from 'bun:test'
import {
  compareWorkspaceVersions,
  createWorkspaceVersion,
  getWorkspaceVersionStatus,
  listWorkspaceVersions,
  restoreWorkspaceVersion,
} from '../workspace-version-control'

describe('workspace version control', () => {
  it('creates a local git snapshot and lists it as history', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-version-'))
    try {
      await writeFile(join(root, 'chapter.md'), 'first draft\n')

      const result = await createWorkspaceVersion(root, { reason: 'manual' })
      const status = await getWorkspaceVersionStatus(root)
      const versions = await listWorkspaceVersions(root, 5)

      expect(result.created).toBe(true)
      expect(result.commitHash).toBeTruthy()
      expect(status.isGitRepo).toBe(true)
      expect(status.hasChanges).toBe(false)
      expect(typeof result.commitHash).toBe('string')
      expect(versions[0]?.hash).toBe(result.commitHash as string)
      expect(versions[0]?.subject).toContain('手动保存')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('restores selected content through a new restore snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-version-'))
    try {
      const filePath = join(root, 'chapter.md')
      await writeFile(filePath, 'version one\n')
      const first = await createWorkspaceVersion(root, { reason: 'manual' })
      expect(typeof first.commitHash).toBe('string')

      await writeFile(filePath, 'version two\n')
      await createWorkspaceVersion(root, { reason: 'auto' })

      const result = await restoreWorkspaceVersion(root, first.commitHash as string)
      const restored = await readFile(filePath, 'utf-8')
      const versions = await listWorkspaceVersions(root, 5)

      expect(result.restored).toBe(true)
      expect(restored).toBe('version one\n')
      expect(versions[0]?.subject).toContain('恢复版本')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('creates an isolated repository when workspace is nested inside another repository', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'craft-version-parent-'))
    try {
      await writeFile(join(parent, 'parent.md'), 'parent\n')
      await Bun.$`git init`.cwd(parent).quiet()
      await Bun.$`git -c user.name=Parent -c user.email=parent@example.test add parent.md`.cwd(parent).quiet()
      await Bun.$`git -c user.name=Parent -c user.email=parent@example.test commit --no-gpg-sign -m parent`.cwd(parent).quiet()

      const root = join(parent, 'workspace')
      await Bun.$`mkdir -p ${root}`.quiet()
      await writeFile(join(root, 'chapter.md'), 'workspace\n')

      const result = await createWorkspaceVersion(root, { reason: 'manual' })
      const workspaceTopLevel = await Bun.$`git rev-parse --show-toplevel`.cwd(root).text()
      const parentLog = await Bun.$`git log --oneline`.cwd(parent).text()

      expect(result.created).toBe(true)
      expect(await realpath(workspaceTopLevel.trim())).toBe(await realpath(root))
      expect(parentLog.trim().split('\n')).toHaveLength(1)
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })

  it('labels collaboration boundary snapshots distinctly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-version-'))
    try {
      const filePath = join(root, 'chapter.md')
      await writeFile(filePath, 'first\n')

      const preprompt = await createWorkspaceVersion(root, { reason: 'user-preprompt' })
      await writeFile(filePath, 'second\n')
      const agentTurn = await createWorkspaceVersion(root, { reason: 'agent-turn' })
      const versions = await listWorkspaceVersions(root, 5)

      expect(preprompt.created).toBe(true)
      expect(agentTurn.created).toBe(true)
      expect(versions[1]?.subject).toContain('发送前保存')
      expect(versions[0]?.subject).toContain('Agent 回合保存')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('compares changed files between workspace versions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-version-'))
    try {
      await writeFile(join(root, 'chapter.md'), 'first\n')
      await writeFile(join(root, 'notes.md'), 'keep\n')
      const base = await createWorkspaceVersion(root, { reason: 'manual' })
      expect(typeof base.commitHash).toBe('string')

      await writeFile(join(root, 'chapter.md'), 'second\n')
      await writeFile(join(root, 'new.md'), 'new\n')
      await rm(join(root, 'notes.md'))
      const head = await createWorkspaceVersion(root, { reason: 'manual' })
      expect(typeof head.commitHash).toBe('string')

      const changes = await compareWorkspaceVersions(root, base.commitHash as string, head.commitHash as string)

      expect(changes).toEqual([
        { path: 'chapter.md', status: 'modified' },
        { path: 'new.md', status: 'added' },
        { path: 'notes.md', status: 'deleted' },
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
