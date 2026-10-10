// input: Host data directory, OS-held per-acquisition liveness endpoints, legacy process identities
// output: Exclusive, generation-owned Host lease; explicit override only for unverifiable owners
// pos: Cross-process write ownership for both Electron and headless bootstrap
import { lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createConnection, createServer, type Server } from 'node:net'
import { basename, dirname, join } from 'node:path'
import { CONFIG_DIR } from '@craft-agent/shared/config/paths'
import type { PlatformServices } from '../runtime/platform'

interface Owner { pid: number; startedAt: number; processIdentity?: string; acquisitionId?: string; leaseVersion?: number; livenessEndpoint?: string }
export interface AcquireServerLockOptions {
  /** User-confirmed recovery: treat owners whose liveness cannot be established as exited. Provably live owners still win. */
  overrideUnverifiedOwner?: boolean
}
export class ServerLockError extends Error {
  constructor(public readonly code: 'OWNER_ACTIVE' | 'OWNER_UNKNOWN', public readonly ownerPid?: number) {
    super(code === 'OWNER_ACTIVE'
      ? `Another Storyflow server instance is active (PID ${ownerPid}). Close it and retry.`
      : 'Another Storyflow server instance may be starting, or its identity cannot be verified. Close Storyflow and retry; existing data has been preserved.')
    this.name = 'ServerLockError'
  }
}

// Liveness proof. Each acquisition listens on its own endpoint before publishing its
// marker; the OS removes a named pipe and refuses a Unix socket once the process is
// gone, even if it crashed or its PID was reused. PID identity remains only for older
// owners and for the POSIX cases a socket cannot decide (see requireExited).
function livenessEndpoint(root: string, acquisitionId: string): string | undefined {
  if (process.platform === 'win32') return `\\\\.\\pipe\\storyflow-host-${acquisitionId}`
  const path = join(root, `.host-${acquisitionId.replaceAll('-', '').slice(0, 16)}.sock`)
  // sockaddr_un is 104 bytes on macOS; longer data directories use PID identity.
  return Buffer.byteLength(path) < 100 ? path : undefined
}

async function listenLiveness(endpoint: string): Promise<Server> {
  const server = createServer(socket => socket.destroy())
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(endpoint, () => { server.off('error', reject); resolve() })
  })
  server.unref()
  return server
}

/** Resolves 'alive', 'timeout', or the connect error code. */
function probeLiveness(endpoint: string): Promise<string> {
  return new Promise(resolve => {
    const socket = createConnection(endpoint)
    const settle = (result: string) => { clearTimeout(timer); socket.destroy(); resolve(result) }
    const timer = setTimeout(() => settle('timeout'), 3000)
    socket.once('connect', () => settle('alive'))
    socket.once('error', error => settle((error as NodeJS.ErrnoException).code ?? 'unknown'))
  })
}

// Owner records are data: only our own socket naming inside the data directory is removed.
function removeStaleSocket(owner: Owner): void {
  const path = owner.livenessEndpoint
  if (process.platform === 'win32' || !path || !/^\.host-[a-f0-9]{16}\.sock$/.test(basename(path))) return
  try {
    if (dirname(path) === realpathSync(CONFIG_DIR) && lstatSync(path).isSocket()) unlinkSync(path)
  } catch { /* Absent or foreign: never authority over the lease. */ }
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
        `[System.Diagnostics.Process]::GetProcessById(${pid}).StartTime.ToUniversalTime().ToString('o')`],
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
    if (value.livenessEndpoint !== undefined && (typeof value.livenessEndpoint !== 'string' || !value.livenessEndpoint)) return null
    return { ...value, startedAt: typeof value.startedAt === 'number' ? value.startedAt : 0 }
  } catch { return null }
}

async function requireExited(owner: Owner | null, override: boolean): Promise<void> {
  if (owner?.livenessEndpoint) {
    const liveness = await probeLiveness(owner.livenessEndpoint)
    if (liveness === 'alive') throw new ServerLockError('OWNER_ACTIVE', owner.pid)
    if (process.platform === 'win32') {
      // A pipe name exists only while a process holds its server handle: busy
      // instances (stalled owner), access denied (elevated owner) or a timeout all
      // prove it is running. Only ENOENT proves exit, so the override never applies.
      if (liveness === 'ENOENT') return
      throw new ServerLockError('OWNER_ACTIVE', owner.pid)
    }
    if (liveness === 'ECONNREFUSED') {
      // XNU also refuses while a stalled owner's backlog is full; a matching
      // creation identity keeps it alive. A mismatch or missing identity trusts the socket.
      if (owner.processIdentity && processIdentity(owner.pid)?.identity === owner.processIdentity) {
        throw new ServerLockError('OWNER_ACTIVE', owner.pid)
      }
      return
    }
    // ENOENT: the socket file may have been removed externally, which proves nothing.
  }
  const unknown = (pid?: number) => { if (!override) throw new ServerLockError('OWNER_UNKNOWN', pid) }
  if (!owner) return unknown()
  try { process.kill(owner.pid, 0) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
    return unknown(owner.pid)
  }
  const current = processIdentity(owner.pid)
  if (!current) return unknown(owner.pid)
  if (owner.processIdentity) {
    if (owner.processIdentity !== current.identity) return
    throw new ServerLockError('OWNER_ACTIVE', owner.pid)
  }
  // Legacy wall-clock timestamps cannot prove reuse: clock corrections can make
  // a live owner appear older than the current boot or process creation time.
  return unknown(owner.pid)
}

function readOwner(path: string): Owner | null {
  try { return parseOwner(readFileSync(path, 'utf8')) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

let held: { lease: string; compatibility: string; marker: string; owner: Owner; liveness?: Server } | undefined
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

const MARKER = /^owner-[a-f0-9-]+\.json$/

// Unrecognized ownership state is never deleted: after user confirmation it is moved
// aside in the data directory so it no longer blocks startup and remains inspectable.
function setAside(path: string): void {
  renameSync(path, `${path}.unrecognized-${Date.now()}`)
}

/**
 * Returns false while the lease is mid-transition (a peer is releasing it) so the
 * caller retries; `settle` forces a decision once retries are exhausted. Reclaimed
 * owners are appended to `exited` for socket cleanup by the caller.
 */
async function reclaimLease(lease: string, compatibility: string, override: boolean, settle: boolean, exited: Owner[]): Promise<boolean> {
  const entries = lstatSync(lease).isDirectory() ? readdirSync(lease) : null
  if (entries?.length === 1 && MARKER.test(entries[0]!)) {
    const marker = entries[0]!
    let raw: string
    try { raw = readFileSync(join(lease, marker), 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
    const owner = parseOwner(raw)
    if (owner?.acquisitionId && marker === `owner-${owner.acquisitionId}.json`) {
      await requireExited(owner, override)
      removeGeneration(lease, marker)
      exited.push(owner)
      return true
    }
    // Torn marker (power loss before it reached disk) or foreign content: below.
  } else if (entries?.length === 0) {
    // Released v1 proper-lockfile lease: an empty heartbeat directory. Only its
    // compatibility owner can prove that this old-format lease is orphaned. A
    // releasing v3 owner removes compatibility before rmdir, so wait it out first.
    const owner = readOwner(compatibility)
    if (!owner && !settle) return false
    await requireExited(owner, override)
    try { rmdirSync(lease) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return true
  }
  if (!override) throw new ServerLockError('OWNER_UNKNOWN')
  // Any recognizable owner inside still gets its proof-of-life check.
  for (const entry of entries ?? []) {
    if (MARKER.test(entry)) await requireExited(readOwner(join(lease, entry)), override)
  }
  setAside(lease)
  return true
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function acquireServerLock(logger: PlatformServices['logger'], options: AcquireServerLockOptions = {}): Promise<void> {
  if (held) throw new ServerLockError('OWNER_ACTIVE', process.pid)
  const override = options.overrideUnverifiedOwner === true
  if (override) logger.warn('[bootstrap] User-confirmed recovery: unverifiable Host owners are treated as exited')
  const root = realpathSync(CONFIG_DIR)
  const lease = join(root, '.server.lease')
  const compatibility = join(root, '.server.lock')
  const identity = processIdentity(process.pid)
  const acquisitionId = randomUUID()
  const endpoint = livenessEndpoint(root, acquisitionId)
  let liveness: Server | undefined
  if (endpoint) {
    try { liveness = await listenLiveness(endpoint) }
    catch (error) { logger.warn(`[bootstrap] Host liveness endpoint unavailable (${(error as NodeJS.ErrnoException).code ?? 'unknown'}); peers fall back to process identity`) }
  }
  // Publishing a nonempty generation establishes fresh ownership even if our
  // birth query is unavailable. Peers must still prove an existing owner exited.
  const owner: Owner = { pid: process.pid, startedAt: Date.now(), processIdentity: identity?.identity, acquisitionId, leaseVersion: 3, ...(liveness ? { livenessEndpoint: endpoint } : {}) }
  const marker = `owner-${owner.acquisitionId}.json`
  const staging = mkdtempSync(join(root, '.server-acquire-'))
  let published = false
  try {
    writeFileSync(join(staging, marker), JSON.stringify(owner), { flag: 'wx', mode: 0o600 })
    // Stale sockets are removed only after every record is judged: the compatibility
    // record usually names the same owner and must reach the same verdict.
    const exited: Owner[] = []
    for (let attempt = 0; ; attempt++) {
      const last = attempt >= 4
      // Check legacy empty directories before rename (POSIX may replace an empty
      // directory). Generation directories are never replaced by rename.
      let settled = true
      try { settled = await reclaimLease(lease, compatibility, override, last, exited) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if (settled) {
        try { renameSync(staging, lease); break }
        catch (error) {
          const code = (error as NodeJS.ErrnoException).code ?? ''
          if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES', 'EBUSY'].includes(code)) throw error
          // A persistent filesystem refusal is not an ownership question; surface
          // it as-is so recovery shows the real error instead of an override.
          if (last) throw code === 'EEXIST' || code === 'ENOTEMPTY' ? new ServerLockError('OWNER_UNKNOWN') : error
        }
      } else if (last) throw new ServerLockError('OWNER_UNKNOWN')
      // A peer published or is releasing (judged by the next reclaim pass), or
      // Windows briefly holds the staging directory open for antivirus or indexing.
      await sleep(50 * 2 ** attempt)
    }
    published = true
    let old: ReturnType<typeof lstatSync> | undefined
    try { old = lstatSync(compatibility) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (old) {
      const recognized = old.isFile() || (old.isDirectory() && readdirSync(compatibility).join() === 'owner.json')
      const previous = recognized ? readOwner(old.isFile() ? compatibility : join(compatibility, 'owner.json')) : null
      await requireExited(previous, override)
      if (previous) exited.push(previous)
      if (!recognized) setAside(compatibility)
      else if (old.isFile()) unlinkSync(compatibility)
      else { unlinkSync(join(compatibility, 'owner.json')); rmdirSync(compatibility) }
    }
    writeFileSync(compatibility, JSON.stringify(owner), { flag: 'wx', mode: 0o600 })
    for (const previous of exited) removeStaleSocket(previous)
    held = { lease, compatibility, marker, owner, liveness }
    let unreadable = 0
    ownershipMonitor = setInterval(() => {
      try {
        if (hasServerLock()) { unreadable = 0; return }
      } catch {
        // Windows sharing violations are transient. While our endpoint is live no
        // peer can prove us exited, so only sustained unreadability is treated as loss.
        if (++unreadable < 5) return
      }
      logger.error('[bootstrap] Host ownership lost; exiting to stop shared writes')
      process.exit(1)
    }, 1000)
    ownershipMonitor.unref()
  } catch (error) {
    if (published) removeGeneration(lease, marker)
    closeLiveness(liveness, owner)
    throw error
  } finally {
    if (!published) removeGeneration(staging, marker)
  }
}

function closeLiveness(server: Server | undefined, owner: Owner): void {
  if (!server) return
  server.close()
  removeStaleSocket(owner)
}

export function releaseServerLock(): void {
  if (!held) return
  clearInterval(ownershipMonitor)
  ownershipMonitor = undefined
  const { lease, compatibility, marker, owner, liveness } = held
  try {
    if (readOwner(join(lease, marker))?.acquisitionId === owner.acquisitionId) {
      // Remove compatibility while the nonempty generation still excludes peers.
      if (readOwner(compatibility)?.acquisitionId === owner.acquisitionId) unlinkSync(compatibility)
      removeGeneration(lease, marker)
    }
    // Stop answering liveness only once our marker is gone. If removal throws, the
    // endpoint stays live until process exit, so peers never see a published
    // generation whose owner looks exited while it is still running.
    closeLiveness(liveness, owner)
  } finally {
    held = undefined
  }
}

process.on('exit', () => { try { releaseServerLock() } catch { /* Exited owners are recovered on next launch. */ } })
