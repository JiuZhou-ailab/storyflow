// input: User-selected storage parent and the exclusive Host startup lease
// output: Deferred, verified Free Conversation relocation with retained source backup
// pos: Storage migration boundary; points logical runtime/free directly at current storage, retaining old-path aliases

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { cp, lstat, readdir, readlink, rename, symlink, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { CONFIG_DIR } from '../config/paths.ts'

export interface FreeConversationStorage {
  path: string
  pendingPath?: string
  backupPath?: string
  error?: string
}
type RecordState = Omit<FreeConversationStorage, 'path'> & { sourcePath?: string; phase?: 'switching' }
const logicalRoot = (configDir: string) => join(configDir, 'runtime', 'free')
const recordPath = (configDir: string) => join(configDir, 'free-conversation-storage.json')

function readState(configDir: string): RecordState {
  const file = recordPath(configDir)
  if (!existsSync(file)) return {}
  const state = JSON.parse(readFileSync(file, 'utf8'))
  if (!state || typeof state !== 'object' || Array.isArray(state)
    || ['pendingPath', 'backupPath', 'sourcePath'].some(key => state[key] !== undefined && (typeof state[key] !== 'string' || !isAbsolute(state[key])))
    || (state.error !== undefined && typeof state.error !== 'string')) throw new Error('Invalid Free Conversation storage settings')
  if (state.phase !== undefined && (state.phase !== 'switching' || !state.pendingPath || !state.sourcePath || !state.backupPath)) throw new Error('Invalid storage migration phase')
  if (state.sourcePath && state.backupPath && !state.backupPath.startsWith(`${state.sourcePath}.backup-`)) throw new Error('Invalid migration backup path')
  return state
}

function saveState(configDir: string, state: RecordState): void {
  mkdirSync(configDir, { recursive: true })
  const temp = `${recordPath(configDir)}.${randomUUID()}.tmp`
  writeFileSync(temp, JSON.stringify(state), { mode: 0o600 })
  renameSync(temp, recordPath(configDir))
}

export function getFreeConversationStorage(configDir = CONFIG_DIR): FreeConversationStorage {
  const root = logicalRoot(configDir)
  const state = readState(configDir)
  return { path: existsSync(root) ? realpathSync(root) : root, pendingPath: state.phase ? undefined : state.pendingPath, backupPath: state.backupPath, error: state.error }
}

function inside(parent: string, child: string): boolean {
  const part = relative(parent, child)
  return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`))
}

/** Null cancels a pending move. An existing destination is never merged or replaced. */
export function scheduleFreeConversationStorage(parent: string | null, configDir = CONFIG_DIR): FreeConversationStorage {
  const state = readState(configDir)
  if (state.phase === 'switching') throw new Error('Storage move is already switching; restart to finish before choosing another location')
  if (parent === null) {
    saveState(configDir, { backupPath: state.backupPath })
    return getFreeConversationStorage(configDir)
  }
  if (typeof parent !== 'string' || !isAbsolute(parent)) throw new Error('Choose an absolute storage directory')
  if (!lstatSync(realpathSync(parent)).isDirectory()) throw new Error('Choose a storage directory')
  const target = join(realpathSync(parent), 'storyflow-free-conversations')
  const current = getFreeConversationStorage(configDir).path
  if (inside(current, target) || inside(target, current) || inside(existsSync(configDir) ? realpathSync(configDir) : resolve(configDir), target)) throw new Error('Choose a directory outside the current application storage')
  if (existsSync(target)) throw new Error('Destination storyflow-free-conversations already exists; choose another directory')
  saveState(configDir, { pendingPath: target, backupPath: state.backupPath })
  return getFreeConversationStorage(configDir)
}

async function digest(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function verifyCopy(source: string, target: string): Promise<void> {
  const [a, b] = await Promise.all([lstat(source), lstat(target)])
  if (a.isSymbolicLink() && b.isSymbolicLink()) {
    if (await readlink(source) !== await readlink(target)) throw new Error('Copied link differs')
  } else if (a.isDirectory() && b.isDirectory()) {
    const left = (await readdir(source)).sort(), right = (await readdir(target)).sort()
    if (JSON.stringify(left) !== JSON.stringify(right)) throw new Error('Copied directory differs')
    for (const name of left) await verifyCopy(join(source, name), join(target, name))
  } else if (a.isFile() && b.isFile()) {
    if (a.size !== b.size || await digest(source) !== await digest(target)) throw new Error('Copied file differs')
  } else throw new Error('Unsupported or changed storage entry')
}

/** Finish the journaled move before sessions can use the stable entry point. */
async function pointLogicalRoot(root: string, target: string, configDir: string, state: RecordState): Promise<void> {
  const entry = lstatSync(root, { throwIfNoEntry: false })
  if (entry && !entry.isSymbolicLink()) throw new Error('Logical storage entry is not a directory link')
  const next = `${root}.next-${randomUUID()}`
  const previous = `${root}.previous-${randomUUID()}`
  try {
    await symlink(target, next, process.platform === 'win32' ? 'junction' : 'dir')
    // Windows cannot rename over a junction. The pending journal recovers this gap on startup.
    if (process.platform === 'win32' && entry) await rename(root, previous)
    await rename(next, root)
    saveState(configDir, { backupPath: state.backupPath })
  } catch (error) {
    if (!lstatSync(root, { throwIfNoEntry: false }) && lstatSync(previous, { throwIfNoEntry: false })) await rename(previous, root)
    // A usable old link lets the user continue. Only the link switch is retried, never the copy.
    saveState(configDir, { ...state, error: error instanceof Error ? error.message : String(error) })
    if (!existsSync(root)) throw error
  } finally {
    if (lstatSync(previous, { throwIfNoEntry: false }) && existsSync(root)) await unlink(previous)
    if (lstatSync(next, { throwIfNoEntry: false })) await unlink(next)
  }
}

/** The verified destination is authoritative; an offline old disk cannot invalidate it. */
async function finishVerifiedMove(configDir: string, state: RecordState): Promise<void> {
  const root = logicalRoot(configDir), source = state.sourcePath!, target = state.pendingPath!
  try {
    if (!existsSync(target) || !lstatSync(target).isDirectory()) throw new Error('New storage is unavailable; reconnect it to finish moving')
    if (existsSync(dirname(source))) {
      const entry = lstatSync(source, { throwIfNoEntry: false })
      if (entry && !entry.isSymbolicLink()) {
        if (existsSync(state.backupPath!)) throw new Error('Storage backup already exists; original storage retained')
        await rename(source, state.backupPath!)
      }
      if (!lstatSync(source, { throwIfNoEntry: false })) await symlink(target, source, process.platform === 'win32' ? 'junction' : 'dir')
    }
    await pointLogicalRoot(root, target, configDir, state)
  } catch (error) {
    // A missing alias means activation never happened; restore only that untouched backup.
    if (!lstatSync(source, { throwIfNoEntry: false }) && state.backupPath && existsSync(state.backupPath)) await rename(state.backupPath, source)
    // If activation never happened, continue on the original data and abandon the stale copy.
    const originalUsable = existsSync(root) && realpathSync(root) !== target
    saveState(configDir, { ...(originalUsable ? { backupPath: state.backupPath } : state), error: error instanceof Error ? error.message : String(error) })
    if (!existsSync(root)) throw error
  }
}

/** Run only under the Host lease, before sessions, watchers or writers are initialized. */
export async function applyPendingFreeConversationStorage(configDir = CONFIG_DIR): Promise<void> {
  const state = readState(configDir)
  const target = state.pendingPath
  if (!target) return
  const root = logicalRoot(configDir)
  if (state.phase === 'switching') {
    await finishVerifiedMove(configDir, state)
    return
  }
  // Recovery after a process exit between renaming the old root and installing the link.
  if (state.sourcePath && !existsSync(state.sourcePath) && state.backupPath && existsSync(state.backupPath)) renameSync(state.backupPath, state.sourcePath)
  if ((existsSync(root) && realpathSync(root) === target)
    || (state.sourcePath && existsSync(state.sourcePath) && realpathSync(state.sourcePath) === target)) {
    const switching: RecordState = { ...state, phase: 'switching' }
    saveState(configDir, switching)
    await finishVerifiedMove(configDir, switching)
    return
  }
  const source = existsSync(root) ? realpathSync(root) : root
  const backup = `${source}.backup-${randomUUID()}`
  try {
    mkdirSync(dirname(root), { recursive: true })
    if (lstatSync(root, { throwIfNoEntry: false })?.isSymbolicLink() && !existsSync(root)) throw new Error('Current storage is unavailable; reconnect it before moving')
    if (realpathSync(dirname(target)) !== dirname(target)) throw new Error('Destination parent changed; choose it again')
    if (existsSync(target)) throw new Error('Destination already exists; original storage retained')
    if (existsSync(root)) {
      if (inside(source, target) || inside(target, source)) throw new Error('Storage directories overlap')
      await cp(source, target, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true, verbatimSymlinks: true })
      await verifyCopy(source, target)
    } else mkdirSync(target)
    saveState(configDir, { phase: 'switching', pendingPath: target, sourcePath: source, backupPath: backup })
  } catch (error) {
    // Never delete either copy on failure. Restore the stable path if the switch was interrupted.
    if (!existsSync(source) && existsSync(backup)) await rename(backup, source)
    saveState(configDir, { backupPath: existsSync(backup) ? backup : state.backupPath, error: error instanceof Error ? error.message : String(error) })
    return
  }
  // Keep the journal until the stable entry no longer depends on a previous disk.
  // Normal upgrades never schedule a move; completed moves do no further filesystem work.
  await finishVerifiedMove(configDir, { phase: 'switching', pendingPath: target, sourcePath: source, backupPath: backup })
}
