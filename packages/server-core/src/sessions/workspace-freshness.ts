// input: Project roots and the project file listing (collectWorkspaceFileList)
// output: Per-session <workspace-brief> of Markdown/text files changed since the session's last turn
// pos: Agent hint only — any failure yields no brief and never blocks or delays a send beyond the timeout

import { stat } from 'fs/promises'
import { collectWorkspaceFileList } from '../handlers/rpc/files'

/** relativePath -> `${size}:${mtimeMs}`; a touched-but-unchanged file only costs the agent one extra read. */
type Manifest = Map<string, string>

const TEXT_FILE_PATTERN = /\.(md|markdown|txt)$/i
const MANIFEST_MAX_ENTRIES = 5000
const MANIFEST_TIMEOUT_MS = 2_000
const STAT_CONCURRENCY = 32
const BRIEF_CHANGE_LIMIT = 20

async function captureManifest(rootPath: string): Promise<Manifest | undefined> {
  const entries = await collectWorkspaceFileList(rootPath, [], MANIFEST_MAX_ENTRIES + 1)
  // A truncated walk would report the files beyond the cap as added or deleted.
  if (entries.length > MANIFEST_MAX_ENTRIES) return undefined
  const files = entries.filter(entry => entry.type === 'file' && TEXT_FILE_PATTERN.test(entry.name))
  const manifest: Manifest = new Map()
  for (let offset = 0; offset < files.length; offset += STAT_CONCURRENCY) {
    const batch = files.slice(offset, offset + STAT_CONCURRENCY)
    const stats = await Promise.allSettled(batch.map(file => stat(file.path)))
    stats.forEach((result, index) => {
      // A file removed mid-walk is simply absent.
      if (result.status === 'fulfilled') manifest.set(batch[index]!.relativePath, `${result.value.size}:${result.value.mtimeMs}`)
    })
  }
  return manifest
}

function withTimeout<T>(operation: Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>(resolve => { timer = setTimeout(resolve, MANIFEST_TIMEOUT_MS, undefined) })
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer))
}

export function formatWorkspaceBrief(previous: Manifest, current: Manifest): string | undefined {
  const changes: string[] = []
  for (const [path, signature] of current) {
    const before = previous.get(path)
    if (before === undefined) changes.push(`${path} added`)
    else if (before !== signature) changes.push(`${path} modified`)
  }
  for (const path of previous.keys()) {
    if (!current.has(path)) changes.push(`${path} deleted`)
  }
  if (changes.length === 0) return undefined
  const visible = changes.sort().slice(0, BRIEF_CHANGE_LIMIT)
  const overflow = changes.length - visible.length
  return [
    '<workspace-brief>',
    'Workspace files changed since your last turn in this session:',
    ...visible.map(change => `- ${change}`),
    ...(overflow > 0 ? [`- ...and ${overflow} more file(s)`] : []),
    '</workspace-brief>',
  ].join('\n')
}

/**
 * Remembers what each session last saw of its project's text files. The
 * checkpoint at turn end absorbs the agent's own edits, so the next send
 * reports only changes made outside the conversation (user edits, other tools).
 * Memory only: after a restart the first send sets the baseline without a brief.
 */
export class WorkspaceFreshness {
  private readonly known = new Map<string, Manifest>()
  private readonly tickets = new Map<string, number>()
  private readonly pending = new Map<string, Promise<void>>()

  /** Turn end: record the state the agent left behind. */
  checkpoint(sessionId: string, rootPath: string): Promise<void> {
    const ticket = this.nextTicket(sessionId)
    const run = this.capture(rootPath).then(manifest => {
      if (this.tickets.get(sessionId) !== ticket) return
      if (manifest) this.known.set(sessionId, manifest)
      else this.known.delete(sessionId)
    }).finally(() => {
      if (this.pending.get(sessionId) === run) this.pending.delete(sessionId)
    })
    this.pending.set(sessionId, run)
    return run
  }

  /** Turn start: brief the changes since the last checkpoint, then make now the baseline. */
  async brief(sessionId: string, rootPath: string): Promise<string | undefined> {
    // Otherwise the agent's own edits from the turn that just ended would read as outside changes.
    await this.pending.get(sessionId)
    const previous = this.known.get(sessionId)
    const ticket = this.nextTicket(sessionId)
    const current = await this.capture(rootPath)
    if (this.tickets.get(sessionId) !== ticket) return undefined
    if (!current) {
      this.known.delete(sessionId)
      return undefined
    }
    this.known.set(sessionId, current)
    return previous ? formatWorkspaceBrief(previous, current) : undefined
  }

  forget(sessionId: string): void {
    this.nextTicket(sessionId)
    this.known.delete(sessionId)
  }

  private nextTicket(sessionId: string): number {
    const ticket = (this.tickets.get(sessionId) ?? 0) + 1
    this.tickets.set(sessionId, ticket)
    return ticket
  }

  private capture(rootPath: string): Promise<Manifest | undefined> {
    return withTimeout(captureManifest(rootPath)).catch(() => undefined)
  }
}
