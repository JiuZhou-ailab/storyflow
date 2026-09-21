// input: Host data directory and OS process creation identities
// output: Exclusive, generation-owned Host lease with conservative legacy recovery
// pos: Cross-process write ownership for both Electron and headless bootstrap
import { lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { CONFIG_DIR } from '@craft-agent/shared/config/paths'
import type { PlatformServices } from '../runtime/platform'

interface Owner { pid: number; startedAt: number; processIdentity?: string; acquisitionId?: string; leaseVersion?: number }
export class ServerLockError extends Error {
  constructor(public readonly code: 'OWNER_ACTIVE' | 'OWNER_UNKNOWN', public readonly ownerPid?: number) {
    super(code === 'OWNER_ACTIVE'
      ? `Another Storyflow server instance is active (PID ${ownerPid}). Close it and retry.`
      : 'Another Storyflow server instance may be starting, or its identity cannot be verified. Close Storyflow and retry; existing data has been preserved.')
    this.name = 'ServerLockError'
  }
}

// No TTL can establish that a paused process is dead. Query only process identity,
// never command lines (which may contain secrets). Query failures remain unknown.
function processIdentity(pid: number): { identity: string; startedAt?: number } | null {
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
      const boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()
      return { identity: `${boot}:${fields[19]}` }
    }
    if (process.platform === 'win32') {
      const value = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`],
      { encoding: 'utf8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      if (!value || !Number.isFinite(Date.parse(value))) return null
      return { identity: value, startedAt: Date.parse(value) }
    }
    const value = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='],
      { encoding: 'utf8', timeout: 3000, env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (!value || !Number.isFinite(Date.parse(`${value} UTC`))) return null
    return { identity: value, startedAt: Date.parse(`${value} UTC`) }
  } catch { return null }
}

function parseOwner(raw: string): Owner | null {
  try {
    const value = /^\d+$/.test(raw.trim()) ? { pid: Number(raw), startedAt: 0 } : JSON.parse(raw)
    if (!value || !Number.isSafeInteger(value.pid) || value.pid <= 0) return null
    if (value.processIdentity !== undefined && (typeof value.processIdentity !== 'string' || !value.processIdentity)) return null
    return { ...value, startedAt: typeof value.startedAt === 'number' ? value.startedAt : 0 }
  } catch { return null }
}

function requireExited(owner: Owner | null): void {
  if (!owner) throw new ServerLockError('OWNER_UNKNOWN')
  try { process.kill(owner.pid, 0) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
    throw new ServerLockError('OWNER_UNKNOWN', owner.pid)
  }
  const current = processIdentity(owner.pid)
  if (!current) throw new ServerLockError('OWNER_UNKNOWN', owner.pid)
  if (owner.processIdentity) {
    if (owner.processIdentity !== current.identity) return
    throw new ServerLockError('OWNER_ACTIVE', owner.pid)
  }
  // Legacy wall-clock timestamps cannot prove reuse: clock corrections can make
  // a live owner appear older than the current boot or process creation time.
  throw new ServerLockError('OWNER_UNKNOWN', owner.pid)
}

function readOwner(path: string): Owner | null {
  try { return parseOwner(readFileSync(path, 'utf8')) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

let held: { lease: string; compatibility: string; marker: string; owner: Owner } | undefined
let ownershipMonitor: ReturnType<typeof setInterval> | undefined

/** Used only by a host that acquired ownership before its pre-bootstrap migrations. */
export function hasServerLock(): boolean {
  return !!held && readOwner(join(held.lease, held.marker))?.acquisitionId === held.owner.acquisitionId
}

// The marker name is the acquisition identity. Never recursively delete a lease:
// another acquisition is published already nonempty, so rmdir cannot remove it.
function removeGeneration(lease: string, marker: string): void {
  try { unlinkSync(join(lease, marker)) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  try { rmdirSync(lease) }
  catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
  }
}

function reclaimLease(lease: string, compatibility: string): void {
  if (!lstatSync(lease).isDirectory()) throw new ServerLockError('OWNER_UNKNOWN')
  const entries = readdirSync(lease)
  if (entries.length === 1 && /^owner-[a-f0-9-]+\.json$/.test(entries[0]!)) {
    const marker = entries[0]!
    const owner = readOwner(join(lease, marker))
    if (!owner?.acquisitionId || marker !== `owner-${owner.acquisitionId}.json`) throw new ServerLockError('OWNER_UNKNOWN')
    requireExited(owner)
    removeGeneration(lease, marker)
  } else if (entries.length === 0) {
    // Released v1 proper-lockfile lease: an empty heartbeat directory. Only its
    // compatibility owner can prove that this old-format lease is orphaned.
    requireExited(readOwner(compatibility))
    try { rmdirSync(lease) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  } else throw new ServerLockError('OWNER_UNKNOWN')
}

export async function acquireServerLock(logger: PlatformServices['logger']): Promise<void> {
  if (held) throw new ServerLockError('OWNER_ACTIVE', process.pid)
  const root = realpathSync(CONFIG_DIR)
  const lease = join(root, '.server.lease')
  const compatibility = join(root, '.server.lock')
  const identity = processIdentity(process.pid)
  if (!identity) throw new ServerLockError('OWNER_UNKNOWN', process.pid)
  const owner: Owner = { pid: process.pid, startedAt: Date.now(), processIdentity: identity.identity, acquisitionId: randomUUID(), leaseVersion: 2 }
  const marker = `owner-${owner.acquisitionId}.json`
  const staging = mkdtempSync(join(root, '.server-acquire-'))
  let published = false
  try {
    writeFileSync(join(staging, marker), JSON.stringify(owner), { flag: 'wx', mode: 0o600 })
    // Check legacy empty directories before rename (POSIX may replace an empty
    // directory). Generation directories are never replaced by rename.
    try { reclaimLease(lease, compatibility) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    try { renameSync(staging, lease) }
    catch (error) {
      if (['EEXIST', 'ENOTEMPTY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw new ServerLockError('OWNER_UNKNOWN')
      throw error
    }
    published = true
    let old: ReturnType<typeof lstatSync> | undefined
    try { old = lstatSync(compatibility) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (old) {
      if (!old.isFile() && !old.isDirectory()) throw new ServerLockError('OWNER_UNKNOWN')
      const path = old.isDirectory() ? join(compatibility, 'owner.json') : compatibility
      requireExited(readOwner(path))
      unlinkSync(path)
      if (old.isDirectory()) rmdirSync(compatibility)
    }
    writeFileSync(compatibility, JSON.stringify(owner), { flag: 'wx', mode: 0o600 })
    held = { lease, compatibility, marker, owner }
    ownershipMonitor = setInterval(() => {
      try { if (hasServerLock()) return } catch { /* Unreadable ownership is not authority to write. */ }
      logger.error('[bootstrap] Host ownership lost; exiting to stop shared writes')
      process.exit(1)
    }, 1000)
    ownershipMonitor.unref()
  } catch (error) {
    if (published) removeGeneration(lease, marker)
    throw error
  } finally {
    if (!published) removeGeneration(staging, marker)
  }
}

export function releaseServerLock(): void {
  if (!held) return
  clearInterval(ownershipMonitor)
  ownershipMonitor = undefined
  const { lease, compatibility, marker, owner } = held
  try {
    if (readOwner(join(lease, marker))?.acquisitionId !== owner.acquisitionId) return
    // Remove compatibility while the nonempty generation still excludes peers.
    if (readOwner(compatibility)?.acquisitionId === owner.acquisitionId) unlinkSync(compatibility)
    removeGeneration(lease, marker)
  } finally { held = undefined }
}

process.on('exit', () => { try { releaseServerLock() } catch { /* Exited owners are recovered on next launch. */ } })
