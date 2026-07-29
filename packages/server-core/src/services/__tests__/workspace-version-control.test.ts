// input: Temporary workspaces plus the public workspace version-control API
// output: Git-backed snapshot, history, comparison, status, and restore behavior checks
// pos: Public-seam integration tests for Storyflow workspace history

import { mkdtemp, readFile, realpath, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, it } from 'bun:test'
import {
  compareWorkspaceVersions,
  createWorkspaceVersion,
  getWorkspaceVersionStatus,
  listWorkspaceVersions,
  readWorkspaceFileAtCommit,
  restoreWorkspaceVersion,
} from '../workspace-version-control'

async function readUserGitState(root: string) {
  const [head, branch, history, index, stagedDiff, status] = await Promise.all([
    Bun.$`git rev-parse HEAD`.cwd(root).quiet().text(),
    Bun.$`git branch --show-current`.cwd(root).quiet().text(),
    Bun.$`git log --format=%H%x09%s`.cwd(root).quiet().text(),
    Bun.$`git ls-files --stage`.cwd(root).quiet().text(),
    Bun.$`git diff --cached --binary`.cwd(root).quiet().text(),
    Bun.$`git status --porcelain=v1`.cwd(root).quiet().text(),
  ])
  return { head, branch, history, index, stagedDiff, status }
}

describe('workspace version control', () => {
  it('serializes concurrent snapshots and status reads per workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-version-concurrent-'))
    try {
      await writeFile(join(root, 'draft.md'), 'one\n')
      const operations = await Promise.all([
        createWorkspaceVersion(root, { reason: 'auto' }),
        createWorkspaceVersion(root, { reason: 'manual' }),
        getWorkspaceVersionStatus(root),
        getWorkspaceVersionStatus(root),
      ])

      expect(operations.slice(0, 2).filter(result => 'created' in result && result.created)).toHaveLength(1)
      expect(await listWorkspaceVersions(root, 10)).toHaveLength(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('isolates Storyflow history from an existing repository branch and index', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-version-existing-'))
    try {
      const stagedPath = join(root, 'staged.md')
      const unstagedPath = join(root, 'unstaged.md')
      const untrackedPath = join(root, 'untracked.md')

      await Bun.$`git init -b user-main`.cwd(root).quiet()
      await writeFile(stagedPath, 'base staged\n')
      await writeFile(unstagedPath, 'base unstaged\n')
      await Bun.$`git add staged.md unstaged.md`.cwd(root).quiet()
      await Bun.$`git -c user.name=User -c user.email=user@example.test commit --no-gpg-sign -m "user commit"`.cwd(root).quiet()

      await writeFile(stagedPath, 'user staged\n')
      await Bun.$`git add staged.md`.cwd(root).quiet()
      await writeFile(unstagedPath, 'user unstaged\n')
      await writeFile(untrackedPath, 'user untracked\n')
      const userGitState = await readUserGitState(root)

      const first = await createWorkspaceVersion(root, { reason: 'manual' })
      expect(typeof first.commitHash).toBe('string')
      expect(await listWorkspaceVersions(root, 10)).toHaveLength(1)
      expect(await getWorkspaceVersionStatus(root)).toEqual({
        isGitRepo: true,
        hasChanges: false,
        lastCommit: expect.objectContaining({ hash: first.commitHash }),
      })
      expect(await readWorkspaceFileAtCommit(root, first.commitHash as string, 'untracked.md')).toBe('user untracked\n')
      expect(await readUserGitState(root)).toEqual(userGitState)

      await writeFile(unstagedPath, 'snapshot two\n')
      await rm(untrackedPath)
      await writeFile(join(root, 'later.md'), 'later\n')
      const second = await createWorkspaceVersion(root, { reason: 'auto' })
      expect(typeof second.commitHash).toBe('string')
      expect(await compareWorkspaceVersions(root, first.commitHash as string)).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'later.md', status: 'added' }),
        expect.objectContaining({ path: 'unstaged.md', status: 'modified' }),
        expect.objectContaining({ path: 'untracked.md', status: 'deleted' }),
      ]))

      await writeFile(unstagedPath, 'pending before restore\n')
      await writeFile(join(root, 'checkpoint.md'), 'checkpoint\n')
      expect((await getWorkspaceVersionStatus(root)).hasChanges).toBe(true)

      const restored = await restoreWorkspaceVersion(root, first.commitHash as string)
      const versions = await listWorkspaceVersions(root, 10)

      expect(restored.restoreCommitHash).toBe(versions[0]?.hash)
      expect(versions.map(version => version.subject)).toEqual([
        expect.stringContaining('恢复版本'),
        expect.stringContaining('恢复前保存'),
        expect.stringContaining('自动保存'),
        expect.stringContaining('手动保存'),
      ])
      expect(await readFile(stagedPath, 'utf-8')).toBe('user staged\n')
      expect(await readFile(unstagedPath, 'utf-8')).toBe('user unstaged\n')
      expect(await readFile(untrackedPath, 'utf-8')).toBe('user untracked\n')
      expect(await Bun.file(join(root, 'checkpoint.md')).exists()).toBe(false)
      expect((await getWorkspaceVersionStatus(root)).hasChanges).toBe(false)
      expect(await readUserGitState(root)).toEqual(userGitState)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

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
        expect.objectContaining({ path: 'chapter.md', status: 'modified' }),
        expect.objectContaining({ path: 'new.md', status: 'added' }),
        expect.objectContaining({ path: 'notes.md', status: 'deleted' }),
      ])
      expect(changes[0]?.unifiedDiff).toContain('diff --git a/chapter.md b/chapter.md')
      expect(changes[0]?.unifiedDiff).toContain('-first')
      expect(changes[0]?.unifiedDiff).toContain('+second')
      expect(changes[1]?.unifiedDiff).toContain('new file mode')
      expect(changes[2]?.unifiedDiff).toContain('deleted file mode')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
