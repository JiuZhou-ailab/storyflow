// input: Startup errors and native application metadata
// output: Bounded diagnostic receipts containing no arbitrary error messages or paths
// pos: Minimal observability available even when the main module cannot load
import { app } from 'electron'
import { appendFileSync, mkdirSync, renameSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const STARTUP_CATEGORIES: Record<string, string> = {
  OWNER_ACTIVE: 'ownerActive', OWNER_UNKNOWN: 'ownerUnknown', CONFIG_INVALID: 'configInvalid',
  CONFIG_ACCESS: 'access', EACCES: 'access', EPERM: 'access', EADDRINUSE: 'port',
  TLS_CONFIG: 'tls', RENDERER_LOAD: 'renderer', PRELOAD: 'renderer', RENDERER_CRASH: 'renderer',
}

export function recordStartupFailure(error: unknown, stage: string): string {
  const category = STARTUP_CATEGORIES[(error as { code?: string })?.code ?? ''] ?? 'initialization'
  // Deliberately omit arbitrary messages, stacks, URLs, paths, and nested causes.
  const ownerPid = (error as { ownerPid?: number })?.ownerPid
  const receipt = JSON.stringify({ ...(Number.isSafeInteger(ownerPid) && ownerPid! > 0 ? { ownerPid } : {}), id: randomUUID(), at: new Date().toISOString(), version: app.getVersion(),
    platform: process.platform, arch: process.arch, stage, category })
  try {
    const directory = join(app.getPath('userData'), 'logs')
    mkdirSync(directory, { recursive: true })
    const path = join(directory, 'startup.jsonl')
    try {
      if (statSync(path).size > 128 * 1024) {
        rmSync(`${path}.1`, { force: true })
        renameSync(path, `${path}.1`)
      }
    } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause }
    appendFileSync(path, `${receipt}\n`, { mode: 0o600 })
  } catch { /* The same receipt remains copyable if the log directory is unwritable. */ }
  return receipt
}
