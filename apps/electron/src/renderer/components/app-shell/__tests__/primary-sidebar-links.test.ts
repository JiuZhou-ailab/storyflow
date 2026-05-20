// input: workspace catalog sidebar links
// output: regression coverage for primary sidebar link selection
// pos: protects the directory-first sidebar contract

import { describe, expect, it } from 'bun:test'

import { getPrimarySidebarLinks } from '../primary-sidebar-links'

describe('primary sidebar links', () => {
  it('uses workspace catalog links as the only primary sidebar source', () => {
    const catalogLinks = [{ id: 'nav:writingCatalog' }]
    const legacyLinks = [{ id: 'nav:allSessions' }]

    expect(getPrimarySidebarLinks(catalogLinks, legacyLinks)).toEqual(catalogLinks)
  })

  it('does not fall back to legacy workspace navigation when no catalog is available', () => {
    const legacyLinks = [{ id: 'nav:allSessions' }, { id: 'nav:sources' }]

    expect(getPrimarySidebarLinks([], legacyLinks)).toEqual([])
  })
})
