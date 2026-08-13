// input: ActiveOptionBadges and FreeFormInput sources
// output: Regression coverage for label lookup costs and composer control placement
// pos: Guards chat metadata lookup and the desktop toolbar's source-permission order

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const source = readFileSync(new URL('../ActiveOptionBadges.tsx', import.meta.url), 'utf-8')
const freeFormInputSource = readFileSync(new URL('../input/FreeFormInput.tsx', import.meta.url), 'utf-8')

describe('ActiveOptionBadges label lookup', () => {
  it('builds a label lookup map once per label config change', () => {
    expect(source).toContain('const labelById = React.useMemo')
    expect(source).toContain('new Map(flattenLabels(labels).map(label => [label.id, label]))')
    expect(source).toContain('const config = labelById.get(parsed.id)')
    expect(source).not.toContain('const flat = flattenLabels(labels)')
    expect(source).not.toContain('flat.find(l => l.id === parsed.id)')
  })

  it('keeps context and labels above the input while permission follows sources in the toolbar', () => {
    expect(source).not.toContain('StateBadge')
    expect(source).not.toContain('FilesPopoverButton')
    expect(source).not.toContain('PermissionModeDropdown')
    expect(source).toContain('leadingContent?: React.ReactNode')
    expect(source).not.toContain('DesktopPermissionModeSelector')

    const desktopToolbar = freeFormInputSource.slice(
      freeFormInputSource.indexOf('{/* Desktop: attachment, source, and permission controls */}'),
      freeFormInputSource.indexOf('{/* Spacer */}'),
    )
    expect(desktopToolbar).toContain('data-tutorial="source-selector-button"')
    expect(desktopToolbar).toContain('<DesktopPermissionModeSelector')
    expect(desktopToolbar.indexOf('data-tutorial="source-selector-button"'))
      .toBeLessThan(desktopToolbar.indexOf('<DesktopPermissionModeSelector'))
  })
})
