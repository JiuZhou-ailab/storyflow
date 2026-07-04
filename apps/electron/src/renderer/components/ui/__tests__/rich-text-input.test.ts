import { readFileSync } from 'fs'
import { describe, it, expect } from 'bun:test'
import {
  exceedsLongTextLineThreshold,
  isEscapeDuringComposition,
} from '../rich-text-input'

describe('isEscapeDuringComposition', () => {
  it('returns true for Escape when local composition ref is active', () => {
    expect(isEscapeDuringComposition({ key: 'Escape' }, true)).toBe(true)
  })

  it('returns true for Escape when nativeEvent.isComposing is true', () => {
    expect(
      isEscapeDuringComposition(
        { key: 'Escape', nativeEvent: { isComposing: true } },
        false
      )
    ).toBe(true)
  })

  it('returns true for Escape when event.isComposing is true', () => {
    expect(isEscapeDuringComposition({ key: 'Escape', isComposing: true }, false)).toBe(true)
  })

  it('returns false for Escape when no composition signal is active', () => {
    expect(isEscapeDuringComposition({ key: 'Escape' }, false)).toBe(false)
  })

  it('returns false for non-Escape keys even if composing', () => {
    expect(isEscapeDuringComposition({ key: 'Enter', isComposing: true }, true)).toBe(false)
  })
})

describe('exceedsLongTextLineThreshold', () => {
  it('detects long pasted text without requiring exact full line count', () => {
    expect(exceedsLongTextLineThreshold(Array.from({ length: 100 }, () => 'x').join('\n'))).toBe(false)
    expect(exceedsLongTextLineThreshold(Array.from({ length: 101 }, () => 'x').join('\n'))).toBe(true)
  })
})

describe('RichTextInput mention hot paths', () => {
  it('skips mention signature work for ordinary input without bracket tokens', () => {
    const source = readFileSync(new URL('../rich-text-input.tsx', import.meta.url), 'utf-8')
    const handlerStart = source.indexOf('const handleInput = React.useCallback')
    const handlerEnd = source.indexOf('// Handle composition events', handlerStart)
    const handlerSource = source.slice(handlerStart, handlerEnd)

    expect(handlerSource).toContain("const mayHaveMentions = newText.includes('[') || !!lastMentionSignatureRef.current")
    expect(handlerSource).toContain('if (mayHaveMentions) {')
    expect(handlerSource).toContain('const newSignature = getMentionSignature(newText, skillSlugs, sourceSlugs)')
  })

  it('skips parsing mentions for render layout when value has no bracket tokens', () => {
    const source = readFileSync(new URL('../rich-text-input.tsx', import.meta.url), 'utf-8')
    const hasMentionsStart = source.indexOf('const hasMentions = React.useMemo')
    const hasMentionsEnd = source.indexOf('return (', hasMentionsStart)
    const hasMentionsSource = source.slice(hasMentionsStart, hasMentionsEnd)

    expect(hasMentionsSource).toContain("if (!safeValue.includes('[')) return false")
    expect(hasMentionsSource).toContain('const mentions = parseMentions(safeValue, skillSlugs, sourceSlugs)')
  })

  it('reuses mention lookup data while converting text to html', () => {
    const source = readFileSync(new URL('../rich-text-input.tsx', import.meta.url), 'utf-8')
    const textToHTMLStart = source.indexOf('function textToHTML')
    const textToHTMLEnd = source.indexOf('function getMentionSignature', textToHTMLStart)
    const textToHTMLSource = source.slice(textToHTMLStart, textToHTMLEnd)

    expect(source).toContain('const skillBySlug = React.useMemo')
    expect(source).toContain('const sourceBySlug = React.useMemo')
    expect(source).toContain('textToHTML(newText, skillSlugs, sourceSlugs, skillBySlug, sourceBySlug')
    expect(textToHTMLSource).not.toContain('skills.map(s => s.slug)')
    expect(textToHTMLSource).not.toContain('sources.map(s => s.config.slug)')
    expect(textToHTMLSource).not.toContain('skills.find(s => s.slug === match.id)')
    expect(textToHTMLSource).not.toContain('sources.find(s => s.config.slug === match.id)')
  })
})
