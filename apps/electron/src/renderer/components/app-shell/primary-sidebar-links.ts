// input: workspace catalog sidebar links and optional legacy navigation links
// output: primary sidebar links for the directory-first app shell
// pos: boundary that prevents legacy session/resource navigation from re-entering the sidebar

export interface SidebarLinkLike {
  id: string
}

export function getPrimarySidebarLinks<T extends SidebarLinkLike>(
  workspaceCatalogLinks: T[],
  _legacyLinks: T[] = [],
): T[] {
  return workspaceCatalogLinks
}
