// input: Workspace root paths and git command availability
// output: Local git snapshot, history, status, and restore helpers
// pos: Server-side version-control adapter for user workspaces

import { execFile } from 'child_process'
import { realpath } from 'fs/promises'

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
  reason: 'auto' | 'manual' | 'before-restore' | 'restore'
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

const GIT_TIMEOUT_MS = 10_000

async function runGit(rootPath: string, args: string[]): Promise<string> {
  return await new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd: rootPath,
      encoding: 'utf-8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        const message = stderr.trim() || stdout.trim() || error.message
        reject(new Error(message))
        return
      }
      resolve(stdout.trim())
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

async function getPorcelainStatus(rootPath: string): Promise<string[]> {
  const output = await runGit(rootPath, ['status', '--porcelain'])
  return output ? output.split('\n').filter(Boolean) : []
}

function buildSnapshotSubject(options: CreateWorkspaceVersionOptions): string {
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
  if (options.reason === 'auto') return `Auto snapshot ${stamp}`
  if (options.reason === 'before-restore') return `Before restore snapshot ${stamp}`
  if (options.reason === 'restore') return `Restore snapshot ${options.label ?? stamp}`
  return `Manual snapshot ${stamp}`
}

async function getHeadHash(rootPath: string): Promise<string | undefined> {
  try {
    return await runGit(rootPath, ['rev-parse', 'HEAD'])
  } catch {
    return undefined
  }
}

export async function getWorkspaceVersionStatus(rootPath: string): Promise<WorkspaceVersionStatus> {
  const repo = await isGitRepo(rootPath)
  if (!repo) {
    return { isGitRepo: false, hasChanges: true, lastCommit: null }
  }

  const [changes, latest] = await Promise.all([
    getPorcelainStatus(rootPath),
    listWorkspaceVersions(rootPath, 1),
  ])

  return {
    isGitRepo: true,
    hasChanges: changes.length > 0,
    lastCommit: latest[0] ?? null,
  }
}

export async function createWorkspaceVersion(
  rootPath: string,
  options: CreateWorkspaceVersionOptions,
): Promise<CreateWorkspaceVersionResult> {
  await ensureGitRepo(rootPath)
  await runGit(rootPath, ['add', '-A', '--', '.'])

  const changes = await getPorcelainStatus(rootPath)
  if (changes.length === 0) {
    return {
      created: false,
      commitHash: await getHeadHash(rootPath),
      changedFiles: 0,
    }
  }

  const message = buildSnapshotSubject(options)
  await runGit(rootPath, [
    '-c', 'user.name=Craft Agent',
    '-c', 'user.email=craft-agent@local',
    'commit',
    '--no-gpg-sign',
    '-m', message,
  ])

  return {
    created: true,
    commitHash: await getHeadHash(rootPath),
    message,
    changedFiles: changes.length,
  }
}

export async function listWorkspaceVersions(rootPath: string, limit = 20): Promise<WorkspaceVersionEntry[]> {
  if (!await isGitRepo(rootPath)) return []

  try {
    const output = await runGit(rootPath, [
      'log',
      `-${Math.max(1, Math.min(limit, 100))}`,
      '--format=%H%x1f%ct%x1f%s',
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

export async function restoreWorkspaceVersion(
  rootPath: string,
  commitHash: string,
): Promise<RestoreWorkspaceVersionResult> {
  await ensureGitRepo(rootPath)

  const pendingChanges = await getPorcelainStatus(rootPath)
  if (pendingChanges.length > 0) {
    await createWorkspaceVersion(rootPath, { reason: 'before-restore' })
  }

  await runGit(rootPath, ['restore', '--source', commitHash, '--', '.'])
  const restored = await createWorkspaceVersion(rootPath, {
    reason: 'restore',
    label: commitHash.slice(0, 8),
  })

  return {
    restored: true,
    commitHash,
    restoreCommitHash: restored.commitHash,
  }
}
