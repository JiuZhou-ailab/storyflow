// input: Global search dialog, shared command dialog, and AppShell source
// output: Regression coverage for search scope, result context, and dialog semantics
// pos: Guards the user-visible contract of the top-left application search

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const globalSearchSource = readFileSync(new URL('../GlobalSearchDialog.tsx', import.meta.url), 'utf8')
const commandSource = readFileSync(new URL('../../ui/command.tsx', import.meta.url), 'utf8')
const appShellSource = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8')

describe('global search dialog contract', () => {
  test('states the application-wide and current-workspace scopes explicitly', () => {
    expect(globalSearchSource).toContain('workspaceLabel?: string')
    expect(appShellSource).toContain('workspaceLabel={activeWorkspace?.name}')
    expect(globalSearchSource).toContain("globalSearch.scopeHint")
    expect(globalSearchSource).toContain("globalSearch.projectsOnlyHint")
    expect(globalSearchSource).toContain("globalSearch.sessionsInWorkspace")
    expect(globalSearchSource).toContain("globalSearch.filesInWorkspace")
  })

  test('keeps query context and file location visible in results', () => {
    expect(globalSearchSource).toContain("import { highlightMatch } from '@/utils/session'")
    expect(globalSearchSource).toContain("globalSearch.matchCount")
    expect(globalSearchSource).toContain("{file.relativePath}{lineNumber ? `:${lineNumber}` : ''}")
  })

  test('gives the shared command dialog an accessible name and description', () => {
    expect(commandSource).toContain('title: React.ReactNode')
    expect(commandSource).toContain('<DialogTitle className="sr-only">{title}</DialogTitle>')
    expect(commandSource).toContain('<DialogDescription className="sr-only">{description}</DialogDescription>')
    expect(globalSearchSource).toContain("title={t('globalSearch.dialogTitle'")
  })
})
