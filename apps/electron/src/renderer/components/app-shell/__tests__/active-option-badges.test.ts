// input: ActiveOptionBadges source
// output: Regression coverage for active chat badge lookup costs
// pos: Guards chat header label badges from rebuilding label tree lookup per session label change

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const source = readFileSync(new URL('../ActiveOptionBadges.tsx', import.meta.url), 'utf-8')

describe('ActiveOptionBadges label lookup', () => {
  it('builds a label lookup map once per label config change', () => {
    expect(source).toContain('const labelById = React.useMemo')
    expect(source).toContain('new Map(flattenLabels(labels).map(label => [label.id, label]))')
    expect(source).toContain('const config = labelById.get(parsed.id)')
    expect(source).not.toContain('const flat = flattenLabels(labels)')
    expect(source).not.toContain('flat.find(l => l.id === parsed.id)')
  })

  it('keeps context left, labels flexible, and permission mode at the far right', () => {
    expect(source).not.toContain('StateBadge')
    expect(source).not.toContain('FilesPopoverButton')
    expect(source).not.toContain('PermissionModeDropdown')
    expect(source).toContain('leadingContent?: React.ReactNode')
    expect(source).toContain('<DesktopPermissionModeSelector')
    expect(source.indexOf('{leadingContent}')).toBeLessThan(source.indexOf('<DesktopPermissionModeSelector'))
  })
})
