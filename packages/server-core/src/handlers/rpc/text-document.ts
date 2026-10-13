// input: Authenticated runtime context, file identity and versioned text operations
// output: Lossless text reads, conflict-checked saves and bounded persistent recovery copies
// pos: Interactive editor filesystem boundary; legacy file writes remain unchanged
import { access, lstat, mkdir, open, readFile, readdir, realpath, rename, unlink, link } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join, relative, isAbsolute, sep } from 'node:path'
import { RPC_CHANNELS, type TextDocumentTarget, type TextDocumentSave } from '@craft-agent/shared/protocol'
import { getWorkspaceStatePath, isFreeConversationWorkspaceId, resolveProjectOwnedFilePath, resolveRuntimeWorkspaceById } from '@craft-agent/shared/workspaces'
import type { RpcServer, RequestContext } from '../../transport'
import type { HandlerDeps } from '../handler-deps'
import { resolveContextWorkspaceId, validateWorkspaceMutationPath, withWorkspaceMutation } from './file-workspace-scope'
import { notifyConfigWatcherForWrite } from './workspace-file-effects'
import { getConversationFiles } from './session-conversation-files'

const MAX_BYTES = 5 * 1024 * 1024
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
const pending = new Map<string, Promise<unknown>>()

// Serializes this boundary only. External writers do not participate; recovery preserves observed versions.
async function serial<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const previous = pending.get(path) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(operation)
  pending.set(path, current)
  try { return await current } finally { if (pending.get(path) === current) pending.delete(path) }
}

async function bytesAt(path: string): Promise<Buffer> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Not a regular file')
  if (info.size > MAX_BYTES) throw new Error('File exceeds the 5 MB text editing limit')
  const bytes = await readFile(path)
  if (bytes.length > MAX_BYTES) throw new Error('File exceeds the 5 MB text editing limit')
  return bytes
}

function decode(bytes: Buffer) {
  const bom = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bom ? bytes.subarray(3) : bytes) }
  catch { return { content: '', bom, crlf: false, reason: 'Unsupported text encoding' } }
  const crlf = text.includes('\r\n')
  const rest = text.replaceAll('\r\n', '')
  const reason = /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) ? 'Binary content'
    : rest.includes('\r') || (crlf && rest.includes('\n')) ? 'Mixed or unsupported line endings' : undefined
  return { content: text.replaceAll('\r\n', '\n'), bom, crlf, reason }
}

async function scope<T>(ctx: RequestContext, deps: HandlerDeps, target: TextDocumentTarget,
  action: (path: string, recoveryRoot: string, readOnly: boolean, checkDestination: (path: string) => Promise<string>) => Promise<T>): Promise<T> {
  if (!target || typeof target.path !== 'string' || !isAbsolute(target.path)) throw new Error('Invalid file identity')
  const workspaceId = resolveContextWorkspaceId(ctx, deps)
  if (!workspaceId) throw new Error('A runtime workspace is required')
  const workspace = deps.resolveRuntimeWorkspaceById?.(workspaceId) ?? resolveRuntimeWorkspaceById(workspaceId)
  if (!workspace) throw new Error('Workspace unavailable')
  if (isFreeConversationWorkspaceId(workspaceId)) {
    if (!target.sessionId || !deps.sessionManager.getSessions(workspaceId).some(session => session.id === target.sessionId)) throw new Error('Session is outside current runtime')
    return deps.sessionManager.withSessionPathOperation(target.sessionId, async sessionPath => {
      const check = async (path: string) => {
        const safe = resolveProjectOwnedFilePath(sessionPath, path)
        const parts = relative(sessionPath, safe).split(sep)
        if (!['work', 'downloads'].includes(parts[0]!) || parts.length < 2 || parts.some(part => part.startsWith('.'))) throw new Error('File is outside conversation work content')
        await rejectSymlinks(sessionPath, safe)
        return safe
      }
      const attachment = relative(join(sessionPath, 'attachments'), target.path)
      const inAttachments = attachment && !attachment.startsWith('..') && !isAbsolute(attachment)
      let path: string
      if (inAttachments) {
        const content = await getConversationFiles(sessionPath)
        if (!content.groups.find(group => group.kind === 'attachments')?.files.some(file => file.path === target.path)) throw new Error('Not a sent attachment')
        path = resolveProjectOwnedFilePath(sessionPath, target.path)
      } else path = await check(target.path)
      const recoveryRoot = resolveProjectOwnedFilePath(sessionPath, join(sessionPath, '.text-recovery'))
      return action(path, recoveryRoot, Boolean(inAttachments), check)
    })
  }
  if (target.sessionId) throw new Error('Project file must not use a conversation identity')
  return withWorkspaceMutation(ctx, deps, async (_, scoped) => {
    const check = async (path: string) => {
      const safe = await validateWorkspaceMutationPath(scoped, deps, path)
      const parts = relative(workspace.rootPath, safe).split(sep)
      if (parts.includes('.craft-agent') || parts.includes('.git')) throw new Error('Internal state is not editable')
      await rejectSymlinks(workspace.rootPath, safe)
      return safe
    }
    const recoveryRoot = resolveProjectOwnedFilePath(workspace.rootPath, join(getWorkspaceStatePath(workspace.rootPath), 'text-recovery'))
    return action(await check(target.path), recoveryRoot, false, check)
  })
}

async function rejectSymlinks(root: string, path: string) {
  let current = root
  for (const part of relative(root, path).split(sep)) {
    current = join(current, part)
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Symbolic links are not editable') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
}

async function durableFile(path: string, bytes: Buffer, mode = 0o600) {
  const file = await open(path, 'wx', mode)
  try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
}

/** Newest first; ids are the record file names. */
async function recoveryRecords(folder: string): Promise<Array<{ id: string; createdAt: number }>> {
  let names: string[]
  try { names = await readdir(folder) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  return (await Promise.all(names.filter(name => /^[\da-f-]{36}\.json$/.test(name)).map(async name => ({ id: name.slice(0, -5), createdAt: (await lstat(join(folder, name))).mtimeMs })))).sort((a, b) => b.createdAt - a.createdAt)
}

// Autosave writes every idle pause, so an unbroken chain of saves shares one copy
// (earliest before, latest submitted) and each file keeps a bounded history.
const RECOVERY_MERGE_MS = 30 * 60_000
const RECOVERY_MAX_RECORDS = 50

async function writeRecovery(folder: string, before: string, submitted: string, mergeable: boolean) {
  const [latest] = await recoveryRecords(folder)
  let previous: { file: string; createdAt: number; before: string } | undefined
  if (mergeable && latest) {
    const file = join(folder, `${latest.id}.json`)
    try {
      const data = JSON.parse(await readFile(file, 'utf8'))
      // Merge only when nothing else wrote the file since that copy; otherwise its content is history.
      if (data.submitted === before && typeof data.before === 'string' && Date.now() - data.createdAt < RECOVERY_MERGE_MS) {
        previous = { file, createdAt: data.createdAt, before: data.before }
      }
    } catch { /* unreadable copy stays as is; start a new one */ }
  }
  await durableFile(join(folder, `${randomUUID()}.json`), Buffer.from(JSON.stringify({ createdAt: previous?.createdAt ?? Date.now(), before: previous?.before ?? before, submitted })))
  // The merged copy is durable before the one it replaces is removed.
  const kept = (await recoveryRecords(folder)).map(record => join(folder, `${record.id}.json`)).filter(file => file !== previous?.file)
  const stale = kept.slice(RECOVERY_MAX_RECORDS)
  if (previous) stale.push(previous.file)
  await Promise.all(stale.map(file => unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error })))
}

export function registerTextDocumentHandlers(server: RpcServer, deps: HandlerDeps) {
  server.handle(RPC_CHANNELS.file.READ_DOCUMENT, (ctx, target: TextDocumentTarget) => scope(ctx, deps, target, async (path, _, readOnly) => {
    const bytes = await bytesAt(path)
    const decoded = decode(bytes)
    let writable = true
    try { await access(path, constants.W_OK) } catch { writable = false }
    return { content: decoded.content, version: hash(bytes), format: { bom: decoded.bom, crlf: decoded.crlf }, readOnly: readOnly || !writable || !!decoded.reason, reason: decoded.reason }
  }))
  server.handle(RPC_CHANNELS.file.SAVE_DOCUMENT, (ctx, request: TextDocumentSave) => scope(ctx, deps, request, async (path, recoveryRoot, readOnly, checkDestination) => {
    if (readOnly) throw new Error('Attachment originals are immutable')
    if (typeof request.content !== 'string' || typeof request.version !== 'string' || Buffer.byteLength(request.content) > MAX_BYTES) throw new Error('Invalid text save')
    if (Buffer.from(request.content).toString('utf8') !== request.content || request.content.includes('\r')) throw new Error('Text must be valid Unicode with LF line endings')
    const destination = request.destination ? await checkDestination(request.destination) : path
    const lockPath = join(await realpath(dirname(destination)), destination.split(/[\\/]/).pop()!)
    return serial(lockPath, async () => {
      let before: Buffer
      let missing = false
      try { before = await bytesAt(path) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; if (!request.destination) return { status: 'missing' }; missing = true; before = Buffer.alloc(0) }
      if (!request.destination && hash(before) !== request.version) return { status: 'conflict' }
      const decoded = missing ? { content: '', bom: request.format?.bom === true, crlf: request.format?.crlf === true, reason: undefined } : decode(before)
      if (decoded.reason) throw new Error(decoded.reason)
      if (!missing) await access(path, constants.W_OK)
      const submitted = Buffer.from((decoded.bom ? '\uFEFF' : '') + (decoded.crlf ? request.content.replaceAll('\n', '\r\n') : request.content))
      if (submitted.length > MAX_BYTES) throw new Error('File exceeds the text editing limit')
      if (!request.destination && before.equals(submitted)) return { status: 'saved', version: hash(before), path }
      const records = join(recoveryRoot, hash(path))
      await rejectSymlinks(dirname(recoveryRoot), records)
      await mkdir(records, { recursive: true, mode: 0o700 })
      await writeRecovery(records, before.toString('utf8'), submitted.toString('utf8'), !request.destination)
      const temp = join(dirname(destination), `.storyflow-${randomUUID()}.tmp`)
      try {
        await durableFile(temp, submitted, missing ? 0o600 : (await lstat(path)).mode & 0o777)
        await checkDestination(destination)
        if (request.destination) {
          // link is exclusive, unlike rename: Save As must never overwrite an existing file.
          await link(temp, destination)
        } else {
          let current: Buffer
          try { current = await bytesAt(path) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' }; throw error }
          if (!before.equals(current)) return { status: 'conflict' }
          await rename(temp, path)
        }
      } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error }) }
      notifyConfigWatcherForWrite(deps, resolveContextWorkspaceId(ctx, deps), destination)
      return { status: 'saved', version: hash(submitted), path: destination }
    })
  }))
  server.handle(RPC_CHANNELS.file.LIST_DOCUMENT_RECOVERY, (ctx, target: TextDocumentTarget) => scope(ctx, deps, target, async (path, root, readOnly) => {
    if (readOnly) return []
    const folder = join(root, hash(path))
    await rejectSymlinks(dirname(root), folder)
    return recoveryRecords(folder)
  }))
  server.handle(RPC_CHANNELS.file.READ_DOCUMENT_RECOVERY, (ctx, target: TextDocumentTarget & { id: string }) => scope(ctx, deps, target, async (path, root, readOnly) => {
    if (readOnly || !/^[\da-f-]{36}$/.test(target.id)) throw new Error('Invalid recovery identity')
    const record = join(root, hash(path), `${target.id}.json`)
    await rejectSymlinks(dirname(root), record)
    const data = JSON.parse(await readFile(record, 'utf8'))
    if (typeof data.before !== 'string' || typeof data.submitted !== 'string') throw new Error('Invalid recovery record')
    return { before: data.before, submitted: data.submitted }
  }))
}
