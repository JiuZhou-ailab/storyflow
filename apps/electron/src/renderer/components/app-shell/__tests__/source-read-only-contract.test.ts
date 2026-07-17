// input: Renderer source menus/list/detail implementation files
// output: Regression proof that shared-global definitions expose no edit/delete UI
// pos: Static ownership-boundary contract for externally managed Sources

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const sourceMenu = readFileSync(new URL('../SourceMenu.tsx', import.meta.url), 'utf8')
const sourcesList = readFileSync(new URL('../SourcesListPanel.tsx', import.meta.url), 'utf8')
const sourceInfo = readFileSync(new URL('../../../pages/SourceInfoPage.tsx', import.meta.url), 'utf8')
const editPopover = readFileSync(new URL('../../ui/EditPopover.tsx', import.meta.url), 'utf8')

describe('shared source read-only UI contract', () => {
  it('makes delete an optional SourceMenu capability', () => {
    expect(sourceMenu).toContain('onDelete?: () => void')
    expect(sourceMenu).toContain('{onDelete && (')
  })

  it('labels shared definitions and withholds list mutations', () => {
    expect(sourcesList).toContain("source.origin === 'shared-global'")
    expect(sourcesList).toContain("t('sourcesList.sharedReadOnly')")
    expect(sourcesList).toContain("source.origin === 'shared-global'\n                    ? undefined")
  })

  it('withholds detail edit/delete actions and explains ownership', () => {
    expect(sourceInfo).toContain("source.origin === 'shared-global'")
    expect(sourceInfo).toContain("source?.origin === 'shared-global' ? undefined : handleDelete")
    expect(sourceInfo).toContain("t('sourceInfo.sharedReadOnlyDescription')")
  })

  it('creates new global definitions only in Storyflow-owned storage', () => {
    expect(editPopover).not.toContain('~/.agents/sources')
    expect(editPopover).toContain('~/.craft-agent/sources')
  })
})
