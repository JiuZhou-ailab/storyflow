// input: Workspace root paths and git command availability
// output: Isolated local git snapshot, history, status, and restore helpers
// pos: Server-side adapter that keeps Storyflow history separate from user git state

import { execFile } from 'child_process'
import { realpath } from 'fs/promises'
import { join } from 'path'

export interface WorkspaceVersionEntry {
  hash: string
  timestamp: number
  subject: string
}

export interface WorkspaceVersionStatus {
  isGitRepo: boolean
  hasChanges: boolean
  lastCommit: WorkspaceVersionEntry | null
}

export interface CreateWorkspaceVersionOptions {
  reason: 'auto' | 'manual' | 'before-restore' | 'restore' | 'user-preprompt' | 'agent-turn'
  label?: string
}

export interface CreateWorkspaceVersionResult {
  created: boolean
  commitHash?: string
  message?: string
  changedFiles: number
}

export interface RestoreWorkspaceVersionResult {
  restored: boolean
  commitHash: string
  restoreCommitHash?: string
}

export interface WorkspaceVersionFileChange {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  previousPath?: string
  unifiedDiff?: string
}

const GIT_TIMEOUT_MS = 10_000
const GIT_MAX_BUFFER_BYTES = 1024 * 1024
/** File content reads need a larger ceiling than metadata queries. */
const GIT_CONTENT_MAX_BUFFER_BYTES = 16 * 1024 * 1024
const STORYFLOW_HISTORY_REF = 'refs/storyflow/history'
const STORYFLOW_INDEX_NAME = 'storyflow-index'
const workspaceOperations = new Map<string, Promise<unknown>>()

interface RunGitOptions {
  /**
   * Keep stdout byte-exact. Required for file content reads, where trimming
   * would silently drop leading/trailing whitespace and the trailing newline.
   */
  raw?: boolean
  maxBuffer?: number
  indexFile?: string
}

async function runGit(rootPath: string, args: string[], options: RunGitOptions = {}): Promise<string> {
  const { raw = false, maxBuffer = GIT_MAX_BUFFER_BYTES, indexFile } = options
  return await new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd: rootPath,
      encoding: 'utf-8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer,
      env: indexFile ? { ...process.env, GIT_INDEX_FILE: indexFile } : undefined,
    }, (error, stdout, stderr) => {
      if (error) {
        const message = stderr.trim() || stdout.trim() || error.message
        reject(new Error(message))
        return
      }
      resolve(raw ? stdout : stdout.trim())
    })
  })
}

async function isGitRepo(rootPath: string): Promise<boolean> {
  try {
    const topLevel = await runGit(rootPath, ['rev-parse', '--show-toplevel'])
    const [resolvedRoot, resolvedTopLevel] = await Promise.all([
      realpath(rootPath),
      realpath(topLevel),
    ])
    return resolvedRoot === resolvedTopLevel
  } catch {
    return false
  }
}

async function ensureGitRepo(rootPath: string): Promise<void> {
  if (await isGitRepo(rootPath)) return
  await runGit(rootPath, ['init'])
}

async function withWorkspaceOperation<T>(rootPath: string, operation: () => Promise<T>): Promise<T> {
  const previous = workspaceOperations.get(rootPath) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(operation)
  workspaceOperations.set(rootPath, current)
  return current.finally(() => {
    if (workspaceOperations.get(rootPath) === current) workspaceOperations.delete(rootPath)
  })
}

async function getStoryflowHead(rootPath: string): Promise<string | undefined> {
  try {
    return await runGit(rootPath, ['rev-parse', '--verify', STORYFLOW_HISTORY_REF])
  } catch {
    return undefined
  }
}

interface PreparedWorkspaceSnapshot {
  changedFiles: string[]
  head?: string
  indexFile: string
  tree: string
}

async function prepareWorkspaceSnapshot(rootPath: string): Promise<PreparedWorkspaceSnapshot> {
  const [gitDir, head] = await Promise.all([
    runGit(rootPath, ['rev-parse', '--absolute-git-dir']),
    getStoryflowHead(rootPath),
  ])
  const indexFile = join(gitDir, STORYFLOW_INDEX_NAME)

  await runGit(rootPath, head ? ['read-tree', head] : ['read-tree', '--empty'], { indexFile })
  await runGit(rootPath, ['add', '-A', '--', '.'], { indexFile })

  const tree = await runGit(rootPath, ['write-tree'], { indexFile })
  if (head && tree === await runGit(rootPath, ['rev-parse', `${head}^{tree}`])) {
    return { changedFiles: [], head, indexFile, tree }
  }

  const output = head
    ? await runGit(rootPath, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', head, tree], { raw: true })
    : await runGit(rootPath, ['ls-files', '-z'], { raw: true, indexFile })

  return {
    changedFiles: output.split('\0').filter(Boolean),
    head,
    indexFile,
    tree,
  }
}

function buildSnapshotSubject(options: CreateWorkspaceVersionOptions): string {
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
  if (options.reason === 'auto') return `自动保存 ${stamp}`
  if (options.reason === 'user-preprompt') return `发送前保存 ${stamp}`
  if (options.reason === 'agent-turn') return `Agent 回合保存 ${stamp}`
  if (options.reason === 'before-restore') return `恢复前保存 ${stamp}`
  if (options.reason === 'restore') return `恢复版本 ${options.label ?? stamp}`
  return `手动保存 ${stamp}`
}

function parseNameStatusLine(line: string): WorkspaceVersionFileChange | null {
  const parts = line.split('\t')
  const code = parts[0]
  if (!code) return null

  if (code.startsWith('R')) {
    const previousPath = parts[1]
    const path = parts[2]
    return previousPath && path ? { path, status: 'renamed', previousPath } : null
  }

  const path = parts[1]
  if (!path) return null

  if (code === 'A') return { path, status: 'added' }
  if (code === 'M') return { path, status: 'modified' }
  if (code === 'D') return { path, status: 'deleted' }
  return { path, status: 'modified' }
}

async function getWorkspaceVersionStatusUnlocked(rootPath: string): Promise<WorkspaceVersionStatus> {
  const repo = await isGitRepo(rootPath)
  if (!repo) {
    return { isGitRepo: false, hasChanges: true, lastCommit: null }
  }

  const [snapshot, latest] = await Promise.all([
    prepareWorkspaceSnapshot(rootPath),
    listWorkspaceVersions(rootPath, 1),
  ])

  return {
    isGitRepo: true,
    hasChanges: snapshot.changedFiles.length > 0,
    lastCommit: latest[0] ?? null,
  }
}

export function getWorkspaceVersionStatus(rootPath: string): Promise<WorkspaceVersionStatus> {
  return withWorkspaceOperation(rootPath, () => getWorkspaceVersionStatusUnlocked(rootPath))
}

async function createWorkspaceVersionUnlocked(
  rootPath: string,
  options: CreateWorkspaceVersionOptions,
): Promise<CreateWorkspaceVersionResult> {
  await ensureGitRepo(rootPath)
  const snapshot = await prepareWorkspaceSnapshot(rootPath)

  if (snapshot.changedFiles.length === 0) {
    return {
      created: false,
      commitHash: snapshot.head,
      changedFiles: 0,
    }
  }

  const message = buildSnapshotSubject(options)
  const commitHash = await runGit(rootPath, [
    '-c', 'user.name=Craft Agent',
    '-c', 'user.email=craft-agent@local',
    'commit-tree',
    snapshot.tree,
    ...(snapshot.head ? ['-p', snapshot.head] : []),
    '-m', message,
  ])
  await runGit(rootPath, ['update-ref', STORYFLOW_HISTORY_REF, commitHash])

  return {
    created: true,
    commitHash,
    message,
    changedFiles: snapshot.changedFiles.length,
  }
}

export function createWorkspaceVersion(
  rootPath: string,
  options: CreateWorkspaceVersionOptions,
): Promise<CreateWorkspaceVersionResult> {
  return withWorkspaceOperation(rootPath, () => createWorkspaceVersionUnlocked(rootPath, options))
}

export async function listWorkspaceVersions(rootPath: string, limit = 20): Promise<WorkspaceVersionEntry[]> {
  if (!await isGitRepo(rootPath)) return []

  try {
    const output = await runGit(rootPath, [
      'log',
      `-${Math.max(1, Math.min(limit, 100))}`,
      '--format=%H%x1f%ct%x1f%s',
      STORYFLOW_HISTORY_REF,
    ])
    if (!output) return []

    return output.split('\n').map((line) => {
      const [hash, timestamp, subject] = line.split('\x1f')
      return {
        hash,
        timestamp: Number(timestamp) * 1000,
        subject,
      }
    }).filter((entry) => entry.hash && Number.isFinite(entry.timestamp))
  } catch {
    return []
  }
}

/**
 * Reads a single file's content as of a commit.
 *
 * Returns `null` when the path does not exist at that commit — absence is a
 * distinct outcome from an empty file, and collapsing the two into `''` is what
 * makes reverting a create/delete ambiguous downstream.
 *
 * Existence is probed with `cat-file -t` rather than by matching `git show`'s
 * error text, because git localizes its messages and text matching would break
 * under a non-English locale.
 */
export async function readWorkspaceFileAtCommit(
  rootPath: string,
  commitHash: string,
  relativePath: string,
): Promise<string | null> {
  if (!await isGitRepo(rootPath)) return null

  const normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalizedPath) return null

  const objectRef = `${commitHash}:${normalizedPath}`

  let objectType: string
  try {
    objectType = await runGit(rootPath, ['cat-file', '-t', objectRef])
  } catch {
    // Path absent at this commit, or the commit itself is unreachable.
    return null
  }

  if (objectType !== 'blob') return null

  return await runGit(rootPath, ['cat-file', 'blob', objectRef], {
    raw: true,
    maxBuffer: GIT_CONTENT_MAX_BUFFER_BYTES,
  })
}

export async function compareWorkspaceVersions(
  rootPath: string,
  baseCommit: string,
  headCommit = STORYFLOW_HISTORY_REF,
): Promise<WorkspaceVersionFileChange[]> {
  if (!await isGitRepo(rootPath)) return []

  const output = await runGit(rootPath, [
    'diff',
    '--name-status',
    '--find-renames',
    `${baseCommit}..${headCommit}`,
  ])
  if (!output) return []

  const changes = output
    .split('\n')
    .map(parseNameStatusLine)
    .filter((change): change is WorkspaceVersionFileChange => change !== null)

  return Promise.all(changes.map(async (change) => {
    const diffPaths = change.previousPath ? [change.previousPath, change.path] : [change.path]
    const unifiedDiff = await runGit(rootPath, [
      'diff',
      '--find-renames',
      `${baseCommit}..${headCommit}`,
      '--',
      ...diffPaths,
    ])
    return {
      ...change,
      unifiedDiff: unifiedDiff || undefined,
    }
  }))
}

async function restoreWorkspaceVersionUnlocked(
  rootPath: string,
  commitHash: string,
): Promise<RestoreWorkspaceVersionResult> {
  await ensureGitRepo(rootPath)

  const pendingSnapshot = await prepareWorkspaceSnapshot(rootPath)
  if (pendingSnapshot.changedFiles.length > 0) {
    await createWorkspaceVersionUnlocked(rootPath, { reason: 'before-restore' })
  }

  const indexFile = pendingSnapshot.indexFile
  await runGit(rootPath, ['read-tree', STORYFLOW_HISTORY_REF], { indexFile })
  await runGit(rootPath, ['restore', '--source', commitHash, '--worktree', '--', '.'], { indexFile })
  const restored = await createWorkspaceVersionUnlocked(rootPath, {
    reason: 'restore',
    label: commitHash.slice(0, 8),
  })

  return {
    restored: true,
    commitHash,
    restoreCommitHash: restored.commitHash,
  }
}

export function restoreWorkspaceVersion(
  rootPath: string,
  commitHash: string,
): Promise<RestoreWorkspaceVersionResult> {
  return withWorkspaceOperation(rootPath, () => restoreWorkspaceVersionUnlocked(rootPath, commitHash))
}
