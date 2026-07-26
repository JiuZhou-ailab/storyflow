import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, it } from 'bun:test'
import {
  createWorkspaceVersion,
  readWorkspaceFileAtCommit,
} from '../workspace-version-control'

describe('readWorkspaceFileAtCommit', () => {
  it('returns file content at a given commit, byte-exact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-read-'))
    try {
      await mkdir(join(root, 'manuscript'), { recursive: true })
      await writeFile(join(root, 'manuscript', 'ch1.md'), '# Title\n\nbody\n')
      const first = await createWorkspaceVersion(root, { reason: 'manual' })

      await writeFile(join(root, 'manuscript', 'ch1.md'), '# Title\n\nCHANGED\n')
      await createWorkspaceVersion(root, { reason: 'manual' })

      const base = await readWorkspaceFileAtCommit(root, first.commitHash as string, 'manuscript/ch1.md')
      expect(base).toBe('# Title\n\nbody\n')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('preserves leading and trailing whitespace instead of trimming it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-read-'))
    try {
      const content = '\n\n  indented start\n\ntrailing blank lines\n\n\n'
      await writeFile(join(root, 'notes.md'), content)
      const version = await createWorkspaceVersion(root, { reason: 'manual' })

      const stored = await readWorkspaceFileAtCommit(root, version.commitHash as string, 'notes.md')
      expect(stored).toBe(content)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('distinguishes an empty file from an absent path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-read-'))
    try {
      await writeFile(join(root, 'empty.md'), '')
      await writeFile(join(root, 'seed.md'), 'seed\n')
      const version = await createWorkspaceVersion(root, { reason: 'manual' })

      const empty = await readWorkspaceFileAtCommit(root, version.commitHash as string, 'empty.md')
      const missing = await readWorkspaceFileAtCommit(root, version.commitHash as string, 'never-created.md')

      expect(empty).toBe('')
      expect(missing).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('returns null for a path that did not exist yet at that commit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-read-'))
    try {
      await writeFile(join(root, 'first.md'), 'first\n')
      const first = await createWorkspaceVersion(root, { reason: 'manual' })

      await writeFile(join(root, 'second.md'), 'second\n')
      const second = await createWorkspaceVersion(root, { reason: 'manual' })

      expect(await readWorkspaceFileAtCommit(root, first.commitHash as string, 'second.md')).toBeNull()
      expect(await readWorkspaceFileAtCommit(root, second.commitHash as string, 'second.md')).toBe('second\n')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('returns null for a directory path rather than a blob listing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-read-'))
    try {
      await mkdir(join(root, 'manuscript'), { recursive: true })
      await writeFile(join(root, 'manuscript', 'ch1.md'), 'body\n')
      const version = await createWorkspaceVersion(root, { reason: 'manual' })

      expect(await readWorkspaceFileAtCommit(root, version.commitHash as string, 'manuscript')).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('normalizes backslash separators and leading slashes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-read-'))
    try {
      await mkdir(join(root, 'manuscript'), { recursive: true })
      await writeFile(join(root, 'manuscript', 'ch1.md'), 'body\n')
      const version = await createWorkspaceVersion(root, { reason: 'manual' })
      const commit = version.commitHash as string

      expect(await readWorkspaceFileAtCommit(root, commit, 'manuscript\\ch1.md')).toBe('body\n')
      expect(await readWorkspaceFileAtCommit(root, commit, '/manuscript/ch1.md')).toBe('body\n')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('returns null outside a git repository and for unknown commits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-read-'))
    try {
      await writeFile(join(root, 'plain.md'), 'plain\n')
      expect(await readWorkspaceFileAtCommit(root, 'HEAD', 'plain.md')).toBeNull()

      const version = await createWorkspaceVersion(root, { reason: 'manual' })
      expect(await readWorkspaceFileAtCommit(root, version.commitHash as string, 'plain.md')).toBe('plain\n')
      expect(await readWorkspaceFileAtCommit(root, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', 'plain.md')).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
