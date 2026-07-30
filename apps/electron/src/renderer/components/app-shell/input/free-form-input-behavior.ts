// input: Composer state and browser input metadata from FreeFormInput/RichTextInput
// output: Pure decisions for input transforms, visibility, and primary action selection
// pos: Keeps IME-sensitive chat input behavior testable without rendering the composer

import type { FileAttachment } from '../../../../shared/types'

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
