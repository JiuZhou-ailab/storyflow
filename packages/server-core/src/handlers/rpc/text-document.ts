// input: Authenticated runtime context, file identity and versioned text operations
// output: Lossless text reads and conflict-checked saves; an empty version recreates a deleted file
// pos: Interactive editor filesystem boundary; legacy file writes remain unchanged
import { access, lstat, open, readFile, realpath, rename, unlink, link } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, join, relative, isAbsolute, sep } from 'node:path'
import { RPC_CHANNELS, type TextDocumentTarget, type TextDocumentSave } from '@craft-agent/shared/protocol'
import { isFreeConversationWorkspaceId, resolveProjectOwnedFilePath, resolveRuntimeWorkspaceById } from '@craft-agent/shared/workspaces'
import type { RpcServer, RequestContext } from '../../transport'
import type { HandlerDeps } from '../handler-deps'
import { resolveContextWorkspaceId, validateWorkspaceMutationPath, withWorkspaceMutation } from './file-workspace-scope'
import { notifyConfigWatcherForWrite } from './workspace-file-effects'
import { getConversationFiles } from './session-conversation-files'

const MAX_BYTES = 5 * 1024 * 1024
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
const pending = new Map<string, Promise<unknown>>()

// Serializes this boundary only. External writers do not participate; the version check before rename catches them.
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
  action: (path: string, readOnly: boolean, recheck: (path: string) => Promise<string>) => Promise<T>): Promise<T> {
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
      return action(path, Boolean(inAttachments), check)
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
    return action(await check(target.path), false, check)
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

export function registerTextDocumentHandlers(server: RpcServer, deps: HandlerDeps) {
  server.handle(RPC_CHANNELS.file.READ_DOCUMENT, (ctx, target: TextDocumentTarget) => scope(ctx, deps, target, async (path, readOnly) => {
    const bytes = await bytesAt(path)
    const decoded = decode(bytes)
    let writable = true
    try { await access(path, constants.W_OK) } catch { writable = false }
    return { content: decoded.content, version: hash(bytes), format: { bom: decoded.bom, crlf: decoded.crlf }, readOnly: readOnly || !writable || !!decoded.reason, reason: decoded.reason }
  }))
  server.handle(RPC_CHANNELS.file.SAVE_DOCUMENT, (ctx, request: TextDocumentSave) => scope(ctx, deps, request, async (path, readOnly, recheck) => {
    if (readOnly) throw new Error('Attachment originals are immutable')
    if (typeof request.content !== 'string' || typeof request.version !== 'string' || Buffer.byteLength(request.content) > MAX_BYTES) throw new Error('Invalid text save')
    if (Buffer.from(request.content).toString('utf8') !== request.content || request.content.includes('\r')) throw new Error('Text must be valid Unicode with LF line endings')
    const lockPath = join(await realpath(dirname(path)), basename(path))
    return serial(lockPath, async () => {
      let before: Buffer | null
      try { before = await bytesAt(path) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; before = null }
      // The version is the expected disk state; '' expects the file to be absent.
      if (!before) { if (request.version !== '') return { status: 'missing' } }
      else if (hash(before) !== request.version) return { status: 'conflict' }
      const decoded = before ? decode(before) : { content: '', bom: request.format?.bom === true, crlf: request.format?.crlf === true, reason: undefined }
      if (decoded.reason) throw new Error(decoded.reason)
      if (before) await access(path, constants.W_OK)
      const submitted = Buffer.from((decoded.bom ? '\uFEFF' : '') + (decoded.crlf ? request.content.replaceAll('\n', '\r\n') : request.content))
      if (submitted.length > MAX_BYTES) throw new Error('File exceeds the text editing limit')
      if (before?.equals(submitted)) return { status: 'saved', version: hash(before) }
      const temp = join(dirname(path), `.storyflow-${randomUUID()}.tmp`)
      try {
        await durableFile(temp, submitted, before ? (await lstat(path)).mode & 0o777 : 0o600)
        await recheck(path)
        if (!before) {
          // link is exclusive, unlike rename: recreating must not replace a file that appeared meanwhile.
          try { await link(temp, path) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return { status: 'conflict' }; throw error }
        } else {
          let current: Buffer
          try { current = await bytesAt(path) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' }; throw error }
          if (!before.equals(current)) return { status: 'conflict' }
          await rename(temp, path)
        }
      } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error }) }
      notifyConfigWatcherForWrite(deps, resolveContextWorkspaceId(ctx, deps), path)
      return { status: 'saved', version: hash(submitted) }
    })
  }))
}
