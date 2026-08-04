// input: Composer state, browser input metadata, and dropped file-system entries
// output: Pure input decisions plus flattened files with stable relative paths
// pos: Keeps IME-sensitive chat input behavior testable without rendering the composer

import type { FileAttachment } from '../../../../shared/types'
import { isSensitiveFilePath } from '@craft-agent/shared/utils/file-safety'

export const MAX_DROPPED_ATTACHMENT_FILES = 100
export const MAX_DROPPED_ATTACHMENT_BYTES = 200 * 1024 * 1024

export type AttachmentBatchLimitError = 'too_many_files' | 'total_size_exceeded'

export interface InputCompositionMeta {
  isComposing?: boolean
  nativeIsComposing?: boolean
  inputType?: string
}

export interface AutoCapitalisationOptions {
  enabled: boolean
  isCompositionInput: boolean
}

export interface AutoCapitalisationResult {
  text: string
  cursor: number
}

export type PrimaryInputAction = 'send' | 'stop'

export interface ModelMenuOption {
  id: string
  name: string
  series: string
  description?: string
  descriptionKey?: string
}

export interface ModelMenuSeries {
  name: string
  models: ModelMenuOption[]
}

export interface DroppedFile {
  file: File
  relativePath: string
}

export interface DroppedFileCollection {
  files: DroppedFile[]
  skippedSensitiveFiles: number
}

interface DroppedDataTransferItem {
  kind: string
  webkitGetAsEntry?: () => FileSystemEntry | null
  getAsFile?: () => File | null
}

interface DroppedDataTransfer {
  items: ArrayLike<DroppedDataTransferItem>
  files: ArrayLike<File>
}

export function groupModelMenuOptions(models: readonly ModelMenuOption[]): ModelMenuSeries[] {
  const groups = new Map<string, ModelMenuOption[]>()

  for (const model of models) {
    const series = model.series.trim() || model.name
    const group = groups.get(series)
    if (group) {
      group.push(model)
    } else {
      groups.set(series, [model])
    }
  }

  return Array.from(groups, ([name, groupedModels]) => ({ name, models: groupedModels }))
}

export async function readAttachmentBatch<TFile>(
  files: readonly TFile[],
  readAttachment: (file: TFile, index: number) => Promise<FileAttachment | null>,
  maxConcurrent = 2,
): Promise<FileAttachment[]> {
  if (files.length === 0) return []

  const attachments: Array<FileAttachment | null> = new Array(files.length).fill(null)
  const workerCount = Math.max(1, Math.min(files.length, Math.floor(maxConcurrent)))
  let nextIndex = 0

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < files.length) {
      const index = nextIndex++
      attachments[index] = await readAttachment(files[index] as TFile, index)
    }
  }))

  return attachments.filter((attachment): attachment is FileAttachment => attachment !== null)
}

function readDroppedFile(entry: FileSystemFileEntry): Promise<File | null> {
  return new Promise(resolve => entry.file(resolve, () => resolve(null)))
}

function readDirectoryBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise(resolve => reader.readEntries(resolve, () => resolve([])))
}

async function collectDroppedEntry(
  entry: FileSystemEntry,
  parentPath: string,
  result: DroppedFileCollection,
): Promise<void> {
  const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name

  if (entry.isFile) {
    if (parentPath && isSensitiveFilePath(relativePath)) {
      result.skippedSensitiveFiles++
      return
    }
    const file = await readDroppedFile(entry as FileSystemFileEntry)
    if (file) {
      const limitError = getAttachmentBatchLimitError([
        ...result.files.map(({ file: collectedFile }) => collectedFile),
        file,
      ])
      if (limitError) throw new Error(limitError)
      result.files.push({ file, relativePath })
    }
    return
  }

  if (!entry.isDirectory) return

  const reader = (entry as FileSystemDirectoryEntry).createReader()
  while (true) {
    const children = await readDirectoryBatch(reader)
    if (children.length === 0) return
    for (const child of children) {
      await collectDroppedEntry(child, relativePath, result)
    }
  }
}

export async function collectDroppedFiles(dataTransfer: DroppedDataTransfer): Promise<DroppedFileCollection> {
  const items = Array.from(dataTransfer.items)
  if (items.length === 0) {
    return {
      files: Array.from(dataTransfer.files, file => ({ file, relativePath: file.name })),
      skippedSensitiveFiles: 0,
    }
  }

  const result: DroppedFileCollection = { files: [], skippedSensitiveFiles: 0 }
  for (const item of items) {
    if (item.kind !== 'file') continue

    const entry = item.webkitGetAsEntry?.()
    if (entry) {
      await collectDroppedEntry(entry, '', result)
      continue
    }

    const file = item.getAsFile?.()
    if (file) {
      const limitError = getAttachmentBatchLimitError([
        ...result.files.map(({ file: collectedFile }) => collectedFile),
        file,
      ])
      if (limitError) throw new Error(limitError)
      result.files.push({ file, relativePath: file.name })
    }
  }

  return result
}

export function getAttachmentBatchLimitError(
  files: readonly { size: number }[],
): AttachmentBatchLimitError | null {
  if (files.length > MAX_DROPPED_ATTACHMENT_FILES) return 'too_many_files'
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  return totalBytes > MAX_DROPPED_ATTACHMENT_BYTES ? 'total_size_exceeded' : null
}

export function isCompositionInput(meta?: InputCompositionMeta): boolean {
  if (!meta) return false
  if (meta.isComposing || meta.nativeIsComposing) return true

  return meta.inputType === 'insertCompositionText'
    || meta.inputType === 'deleteCompositionText'
    || meta.inputType === 'insertFromComposition'
}

export function resolveAutoCapitalisedInput(
  value: string,
  cursorPosition: number,
  options: AutoCapitalisationOptions,
): AutoCapitalisationResult | null {
  if (!options.enabled || options.isCompositionInput) return null
  if (value.length === 0) return null
  if (value.charAt(0) === '/' || value.charAt(0) === '@' || value.charAt(0) === '#') return null

  const capitalizedFirst = value.charAt(0).toUpperCase()
  if (capitalizedFirst === value.charAt(0)) return null

  return {
    text: capitalizedFirst + value.slice(1),
    cursor: cursorPosition,
  }
}

export function getPrimaryInputAction(input: {
  isProcessing?: boolean
  hasContent: boolean
  disabled?: boolean
  disableSend?: boolean
}): PrimaryInputAction {
  if (input.isProcessing && !input.hasContent) {
    return 'stop'
  }
  return 'send'
}

export function shouldShowTextInput(_input: {
  compactMode?: boolean
  isProcessing?: boolean
}): boolean {
  return true
}

/**
 * Publish a local input handle into a parent-shared ref without clobbering a
 * sibling instance. AnimatePresence mode="sync" can mount two FreeFormInputs
 * that share ChatDisplay.textareaRef; unmount of the exiting one must not null
 * the survivor's handle or slash/@ menus lose caret geometry and open at (0,0).
 */
export function assignSharedInputHandle<T>(
  internal: { current: T | null },
  external: { current: T | null } | null | undefined,
  handle: T | null,
): void {
  const previous = internal.current
  internal.current = handle
  if (!external) return
  if (handle) {
    external.current = handle
    return
  }
  if (external.current === previous) {
    external.current = null
  }
}
