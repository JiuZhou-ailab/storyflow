// input: GlobalSearchDialog source
// output: Regression checks for global search dialog render-state churn
// pos: Guards the top-bar global search dialog against no-op content result updates

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../GlobalSearchDialog.tsx', import.meta.url), 'utf8')

describe('GlobalSearchDialog performance contracts', () => {
  it('does not replace content result maps for no-op clears or repeated IPC results', () => {
    expect(source).toContain('function reuseGlobalSearchContentResults')
    expect(source).toContain('const clearContentResults = React.useCallback')
    expect(source).toContain('setContentResults(prev => prev.size === 0 ? prev : new Map())')
    expect(source).toContain('setContentResults(prev => reuseGlobalSearchContentResults(prev, resultMap))')
    expect(source).not.toContain('setContentResults(new Map())')
  })

  it('does not flip searching state during stale query cleanup', () => {
    const cleanupStart = source.indexOf('return () => {\n      cancelled = true')
    const cleanupEnd = source.indexOf('  }, [open, query, workspaceId, clearContentResults])', cleanupStart)
    const cleanupSource = source.slice(cleanupStart, cleanupEnd)

    expect(cleanupSource).toContain('cancelled = true')
    expect(cleanupSource).toContain('window.clearTimeout(timer)')
    expect(cleanupSource).not.toContain('setSearchingContent(false)')
  })
})
