// input: AppShell writing-workspace refresh source
// output: Regression guard for agent-turn file tree refresh ownership
// pos: Keeps checkpoint refreshes from racing the delayed file-change fallback

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const appShellSource = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8')

describe('AppShell writing workspace refresh', () => {
  it('keeps agent-turn file refresh from racing the delayed file-change refresh', () => {
    expect(appShellSource).toContain('const pendingNovelFileChangeRefreshKeys = new Set<string>()')
    expect(appShellSource).toContain('if (pendingNovelFileChangeRefreshKeys.has(refreshKey)) return')
    expect(appShellSource).toContain('pendingNovelFileChangeRefreshKeys.add(refreshKey)')
    expect(appShellSource).toContain('pendingNovelFileChangeRefreshKeys.delete(refreshKey)')
  })
})
