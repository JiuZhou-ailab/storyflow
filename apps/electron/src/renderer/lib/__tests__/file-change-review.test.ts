// input: Captured FileChange records and current file content examples
// output: Regression coverage for safe reject-content generation
// pos: Guards novel review actions against unsafe filesystem rollback

import { describe, expect, it } from 'bun:test'
import type { FileChange } from '@craft-agent/ui'
import { buildRejectedFileContent } from '../file-change-review'

function change(overrides: Partial<FileChange> = {}): FileChange {
  return {
    id: overrides.id ?? 'change-1',
    filePath: overrides.filePath ?? '/novel/story/chapters/chapter-01.md',
    toolType: overrides.toolType ?? 'Edit',
    original: overrides.original ?? 'old sentence',
    modified: overrides.modified ?? 'new sentence',
    unifiedDiff: overrides.unifiedDiff,
    error: overrides.error,
  }
}

describe('buildRejectedFileContent', () => {
  it('replaces a uniquely matched modified snippet with the original snippet', () => {
    const result = buildRejectedFileContent(
      change({ original: 'quiet room', modified: 'crowded room' }),
      'She crossed the crowded room before dawn.'
    )

    expect(result).toEqual({
      ok: true,
      content: 'She crossed the quiet room before dawn.',
    })
  })

  it('rejects full-file replacements when the whole current file matches the modified content', () => {
    const result = buildRejectedFileContent(
      change({ original: '# Chapter 1\n\nOld', modified: '# Chapter 1\n\nNew' }),
      '# Chapter 1\n\nNew'
    )

    expect(result).toEqual({
      ok: true,
      content: '# Chapter 1\n\nOld',
    })
  })

  it('refuses to reject a change when the modified snippet is no longer present', () => {
    const result = buildRejectedFileContent(
      change({ original: 'quiet room', modified: 'crowded room' }),
      'She crossed the empty room before dawn.'
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('Current file no longer matches')
    }
  })

  it('refuses ambiguous replacements when the modified snippet appears more than once', () => {
    const result = buildRejectedFileContent(
      change({ original: 'quiet room', modified: 'crowded room' }),
      'crowded room\ncrowded room'
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('appears more than once')
    }
  })

  it('refuses ambiguous replacements when matches overlap', () => {
    const result = buildRejectedFileContent(
      change({ original: 'old', modified: 'ana' }),
      'banana'
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('appears more than once')
    }
  })

  it('refuses patch-only diffs until the original snippet is available', () => {
    const result = buildRejectedFileContent(
      change({ original: '', modified: '', unifiedDiff: '@@ -1 +1 @@\n-old\n+new' }),
      'new'
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('Patch-only')
    }
  })

  it('refuses write changes without captured previous content', () => {
    const result = buildRejectedFileContent(
      change({ toolType: 'Write', original: '', modified: '# New file' }),
      '# New file'
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('Previous file content was not captured')
    }
  })

  it('reverts write changes when captured previous content is available', () => {
    const result = buildRejectedFileContent(
      change({ toolType: 'Write', original: '# Old file', modified: '# New file' }),
      '# New file'
    )

    expect(result).toEqual({
      ok: true,
      content: '# Old file',
    })
  })
})
