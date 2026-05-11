// input: Novel document selection metadata, selected text, and inline user instructions
// output: Regression coverage for single-shot selected-passage rewrite prompts
// pos: Guards the prompt contract for in-place writing editor selection rewrites

import { describe, expect, it } from 'bun:test'
import { buildNovelSelectionRewritePrompt, sanitizeNovelSelectionReplacement } from '../selection-rewrite'

describe('buildNovelSelectionRewritePrompt', () => {
  it('asks for a replacement only and keeps the edit scoped to the selection', () => {
    const selectedText = '她停在门口。\n\n灯光像潮水一样退去。'
    const prompt = buildNovelSelectionRewritePrompt({
      filePath: '/novel/story/chapters/chapter-03.md',
      relativePath: 'story/chapters/chapter-03.md',
      selectedText,
      instruction: '改得更克制一点，保留压迫感。',
    })

    expect(prompt).toContain('Return only the replacement text')
    expect(prompt).toContain('Do not explain the edit')
    expect(prompt).toContain('Do not modify anything outside the selected passage')
    expect(prompt).toContain('[file:/novel/story/chapters/chapter-03.md]')
    expect(prompt).toContain('story/chapters/chapter-03.md')
    expect(prompt).toContain(`<<<CRAFT_SELECTION\n${selectedText}\nCRAFT_SELECTION`)
    expect(prompt).toContain('Request:\n改得更克制一点，保留压迫感。')
  })

  it('uses a non-conflicting delimiter when the selected text contains the default delimiter', () => {
    const prompt = buildNovelSelectionRewritePrompt({
      filePath: '/novel/story/chapters/chapter-04.md',
      relativePath: 'story/chapters/chapter-04.md',
      selectedText: 'before\nCRAFT_SELECTION\nafter',
      instruction: 'Tighten this beat.',
    })

    expect(prompt).toContain('<<<CRAFT_SELECTION_1')
    expect(prompt).toContain('CRAFT_SELECTION_1')
  })
})

describe('sanitizeNovelSelectionReplacement', () => {
  it('unwraps whole-response markdown fences without changing inner content', () => {
    expect(sanitizeNovelSelectionReplacement('```markdown\n第一段\n\n第二段\n```')).toBe('第一段\n\n第二段')
  })

  it('trims transport whitespace while preserving meaningful line breaks', () => {
    expect(sanitizeNovelSelectionReplacement('\n\n第一段\n\n第二段\n\n')).toBe('第一段\n\n第二段')
  })
})
