// input: SessionMenuParts source
// output: Regression checks for shared session menu render paths
// pos: Keeps label submenu applied counts from recursively rescanning each subtree per row

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const source = readFileSync(new URL('../SessionMenuParts.tsx', import.meta.url), 'utf8')

describe('SessionMenuParts render path', () => {
  it('precomputes applied label counts before rendering label submenus', () => {
    const renderStart = source.indexOf('const renderItems =')
    const renderEnd = source.indexOf('return renderItems(displayLabels)', renderStart)
    const renderSource = source.slice(renderStart, renderEnd)

    expect(source).toContain('function buildAppliedCountByLabelId')
    expect(source).toContain('const appliedCountById = React.useMemo')
    expect(source).toContain('buildAppliedCountByLabelId(displayLabels, appliedLabelIds)')
    expect(renderSource).toContain('appliedCountById.get(label.id) ?? 0')
    expect(renderSource).not.toContain('countAppliedInSubtree(label')
  })
})
