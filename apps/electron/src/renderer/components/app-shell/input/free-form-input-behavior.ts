// input: Composer state and browser input metadata from FreeFormInput/RichTextInput
// output: Pure decisions for input transforms, visibility, and primary action selection
// pos: Keeps IME-sensitive chat input behavior testable without rendering the composer

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
  if (input.isProcessing && (!input.hasContent || input.disabled || input.disableSend)) {
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
