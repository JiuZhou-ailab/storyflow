// input: Novel selection rewrite request metadata and model responses
// output: Prompt construction and replacement-text sanitization for inline rewrites
// pos: Shared prompt contract for one-shot writing editor selection edits

export interface NovelSelectionRewritePromptInput {
  filePath: string
  relativePath: string
  selectedText: string
  instruction: string
}

function createSelectionDelimiter(selectedText: string): string {
  let suffix = ''
  let index = 0

  while (selectedText.includes(`CRAFT_SELECTION${suffix}`)) {
    index += 1
    suffix = `_${index}`
  }

  return `CRAFT_SELECTION${suffix}`
}

export function buildNovelSelectionRewritePrompt({
  filePath,
  relativePath,
  selectedText,
  instruction,
}: NovelSelectionRewritePromptInput): string {
  const delimiter = createSelectionDelimiter(selectedText)

  return [
    'You are rewriting a selected passage in a Markdown manuscript editor.',
    '',
    'Output contract:',
    '- Return only the replacement text for the selected passage.',
    '- Do not explain the edit.',
    '- Do not wrap the answer in a Markdown code fence.',
    '- Do not modify anything outside the selected passage.',
    '- Preserve the language, point of view, and Markdown structure unless the request requires changing them.',
    '',
    `[file:${filePath}]`,
    `Relative path: ${relativePath}`,
    '',
    'Selected passage:',
    `<<<${delimiter}`,
    selectedText,
    delimiter,
    '',
    'Request:',
    instruction.trim(),
  ].join('\n')
}

export function sanitizeNovelSelectionReplacement(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```$/i)
  return (fenced?.[1] ?? trimmed).trim()
}
