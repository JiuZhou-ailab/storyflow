// input: Validated session storage directory and persisted attachment records
// output: Bounded conversation-owned content groups, excluding runtime files and symlinks
// pos: Filesystem projection for the conversation view of the session files RPC

import { createReadStream } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'
import type { ConversationFile, ConversationFiles, FileAttachment } from '@craft-agent/shared/protocol'
import { expandSessionPath } from '@craft-agent/shared/sessions/jsonl'
import { getAttachmentRepresentationPath } from '@craft-agent/shared/utils/files'
import { resolveProjectOwnedFilePath } from '@craft-agent/shared/workspaces'

async function statIfPresent(path: string) {
  try {
    return await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function getConversationFiles(sessionPath: string): Promise<ConversationFiles> {
  const result: ConversationFiles = { groups: [], truncated: false }
  // ponytail: one bounded eager tree; use lazy children if large conversations need full browsing.
  let remaining = 500
  const take = () => {
    if (remaining > 0) { remaining -= 1; return true }
    result.truncated = true
    return false
  }
  const scan = async (path: string): Promise<ConversationFile[]> => {
    const info = await statIfPresent(path)
    if (!info || info.isSymbolicLink()) return []
    if (!info.isDirectory()) throw new Error('Conversation content root is not a directory')
    resolveProjectOwnedFilePath(sessionPath, path)
    const entries = await readdir(path, { withFileTypes: true })
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    const files: ConversationFile[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) continue
      if (!take()) break
      const childPath = resolveProjectOwnedFilePath(sessionPath, join(path, entry.name))
      if (entry.isDirectory()) {
        const children = await scan(childPath)
        if (children.length) files.push({ name: entry.name, path: childPath, type: 'directory', children })
      } else {
        const childInfo = await statIfPresent(childPath)
        if (childInfo?.isFile()) files.push({ name: entry.name, path: childPath, type: 'file', size: childInfo.size, modifiedAt: childInfo.mtimeMs })
      }
    }
    return files
  }

  for (const kind of ['work', 'downloads'] as const) {
    const files = await scan(join(sessionPath, kind))
    if (files.length) result.groups.push({ kind, files })
  }

  const files: ConversationFile[] = []
  const seen = new Set<string>()
  // Stream the persisted transcript; no renderer transcript hydration or parallel attachment index.
  const stream = createReadStream(resolveProjectOwnedFilePath(sessionPath, join(sessionPath, 'session.jsonl')), { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  let hasHeader = false
  try {
    for await (const line of lines) {
      if (!line.trim()) continue
      const record = JSON.parse(expandSessionPath(line, sessionPath))
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid session record')
      if (!hasHeader) {
        if (typeof record.id !== 'string') throw new Error('Invalid session header')
        hasHeader = true
        continue
      }
      if (record.type !== 'user' || record.attachments === undefined) continue
      if (!Array.isArray(record.attachments)) throw new Error('Invalid session attachments')
      for (const attachment of record.attachments) {
        if (!attachment || typeof attachment.name !== 'string'
          || (attachment.representations !== undefined && (!Array.isArray(attachment.representations)
            || attachment.representations.some((item: unknown) => !item || typeof item !== 'object')))) {
          throw new Error('Invalid attachment metadata')
        }
        const original = getAttachmentRepresentationPath(attachment as FileAttachment, 'original')
        if (typeof original !== 'string' || !original) throw new Error('Attachment original path missing')
        // Original references may use legacy fields, but must still belong to this session.
        const path = resolveProjectOwnedFilePath(sessionPath, resolve(sessionPath, original))
        const attachmentPath = relative(join(sessionPath, 'attachments'), path)
        if (!attachmentPath || attachmentPath === '..' || attachmentPath.startsWith(`..${sep}`) || isAbsolute(attachmentPath)) {
          throw new Error('Original is outside session attachment storage')
        }
        if (seen.has(path)) continue
        seen.add(path)
        if (!take()) continue
        const info = await statIfPresent(path)
        files.push({ name: attachment.name, path, type: 'file', size: info?.size, modifiedAt: info?.mtimeMs, readOnly: true, unavailable: !info?.isFile() })
      }
    }
    if (!hasHeader) throw new Error('Session header missing')
  } finally {
    lines.close()
    stream.destroy()
  }
  if (files.length) result.groups.push({ kind: 'attachments', files })
  return result
}
