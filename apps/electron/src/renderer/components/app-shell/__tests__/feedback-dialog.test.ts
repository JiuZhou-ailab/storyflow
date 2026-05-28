// input: Feedback dialog source
// output: Static regression coverage for compact screenshot UX
// pos: Keeps the feedback form free of redundant attachment prompt panels

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../FeedbackDialog.tsx', import.meta.url), 'utf8')

describe('FeedbackDialog', () => {
  it('keeps screenshot guidance in the details placeholder instead of a separate panel', () => {
    expect(source).toContain('feedback.detailsPlaceholder')
    expect(source).not.toContain('feedback.pasteScreenshot')
    expect(source).not.toContain('border-dashed')
    expect(source).not.toContain('ImagePlus')
  })

  it('closes and resets itself after a successful feedback submission', () => {
    expect(source).toContain('onOpenChange(false)')
    expect(source).toContain('reset()')
  })
})
