// input: Markdown document content, selected text, and file identity metadata
// output: Stable chat quote blocks with optional source line references
// pos: Shared contract for adding writing-editor selections to chat context

export interface NovelSelectionLineRange {
  startLine: number
  endLine: number
}

export interface NovelSelectionContextInput {
  content: string
  selectedText: string
  filePath: string
  relativePath: string
}

export interface NovelSelectionContext {
  filePath: string
  relativePath: string
  selectedText: string
  lineRange: NovelSelectionLineRange | null
}

export function locateUniqueSelectionLineRange(
  content: string,
  selectedText: string,
): NovelSelectionLineRange | null {
  if (!selectedText) return null

  const firstIndex = content.indexOf(selectedText)
  if (firstIndex === -1) return null

  const secondIndex = content.indexOf(selectedText, firstIndex + selectedText.length)
  if (secondIndex !== -1) return null

  const beforeSelection = content.slice(0, firstIndex)
  const selectionStartLine = beforeSelection.split('\n').length
  const selectedLineSpan = selectedText.split('\n').length

  return {
    startLine: selectionStartLine,
    endLine: selectionStartLine + selectedLineSpan - 1,
  }
}

export function buildNovelSelectionContext({
  content,
  selectedText,
  filePath,
  relativePath,
}: NovelSelectionContextInput): NovelSelectionContext {
  return {
    filePath,
    relativePath,
    selectedText,
    lineRange: locateUniqueSelectionLineRange(content, selectedText),
  }
}

function formatLineReference(lineRange: NovelSelectionLineRange | null): string {
  if (!lineRange) return ''
  if (lineRange.startLine === lineRange.endLine) return `:${lineRange.startLine}`
  return `:${lineRange.startLine}-${lineRange.endLine}`
}

export function formatNovelSelectionContextForChat(context: NovelSelectionContext): string {
  const reference = `${context.relativePath}${formatLineReference(context.lineRange)}`
  const quote = context.selectedText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')

  return [`[${reference}]`, quote].join('\n')
}

export function formatNovelSelectionChatMessage(
  context: NovelSelectionContext,
  instruction: string,
): string {
  const trimmedInstruction = instruction.trim()
  const quote = formatNovelSelectionContextForChat(context)
  return trimmedInstruction ? `${quote}\n\n${trimmedInstruction}` : quote
}
