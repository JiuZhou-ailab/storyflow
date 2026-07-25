# Sidebar design QA

## Sources

- Existing implementation:
  `/var/folders/jk/7_pcx4cd3y94_lwnf7hbxcv80000gn/T/codex-clipboard-bf07de50-d5a4-491b-9fa9-e7cb1e116cb4.png`
- Codex reference:
  `/var/folders/jk/7_pcx4cd3y94_lwnf7hbxcv80000gn/T/codex-clipboard-b4d29db0-df2c-489f-a719-ff1efbed6165.png`
- Combined comparison:
  `/Users/dingzhijian/.codex/visualizations/2026/07/23/019f8e31-52d0-7363-95f5-3213b0c0891d/sidebar-qa/sidebar-final-comparison.png`

The Electron QA app used a 1195 × 768 viewport in the user's dark theme. The
references use a taller light-theme window, so color and visible item count are
theme/viewport differences rather than fidelity defects. The comparison is
focused on hierarchy, spacing, disclosure behavior, and fixed regions.

## Iteration 1

P1 findings:

- The active project was removed from the normal project loop and rendered in a
  separate block, so it jumped to the top and used different row geometry.
- A negative horizontal margin made the tree wider than its scroll container,
  causing the horizontal scrollbar and inconsistent left/right insets.
- Project Hub displayed Skills, Sources, Search, Settings, and What's New as
  disabled because navigation required an already-active runtime.

Root fixes:

- Render every project through one stable ordered loop and insert the active
  native directory at that project's existing position.
- Use one horizontal inset system and clip horizontal overflow at both the rail
  and native tree boundaries.
- Resolve global navigation against the active runtime or the most recently
  accessed project.

## Iteration 2

Electron evidence:

- `sidebar-final-project-hub.png`: one sidebar, top tools enabled, recent
  conversations limited, projects grouped, profile fixed at the bottom.
- `sidebar-final-directory.png`: the active project remains fifth in the list,
  uses the same folder-row geometry, and expands its native file tree in place.
- `sidebar-final-collapsed.png`: the Projects header collapses every project as
  one collection.
- `sidebar-final-profile-menu.png`: Account & Points, Settings, What's New, and
  Help & Feedback are enabled inside the single Profile item.
- `sidebar-final-skills-route.png`: one click from Project Hub activates the
  fallback project and opens the Skills route.

Fidelity checks:

- Typography and icons continue to use the existing product system.
- Top item order is Skills, Sources, Search.
- Recent conversations and Projects use matching section-header disclosure.
- Project rows share one left edge, one chevron column, one folder column, and
  one active-row treatment.
- The rail has one vertical scrolling region and no horizontal scrollbar.
- Standalone Writing Workspace and Check Updates items are absent.
- No new raster assets or decorative styling were introduced.
- No P0, P1, or P2 visual or interaction differences remain.

Final result: passed.

## Context menu design QA — 2026-07-23

### Sources

- Existing implementation:
  `/var/folders/jk/7_pcx4cd3y94_lwnf7hbxcv80000gn/T/codex-clipboard-9d5990eb-9acf-4c17-9432-566f1c564934.png`
- Codex reference:
  `/var/folders/jk/7_pcx4cd3y94_lwnf7hbxcv80000gn/T/codex-clipboard-5ad0ca43-409e-4558-81dc-e94fc493f393.png`
- Electron implementation:
  `/Users/dingzhijian/.codex/visualizations/2026/07/23/019f8fb0-ac86-7f52-a0c8-930256c717bb/context-menu-qa/context-menu-implementation-open.jpg`
- Combined comparison:
  `/Users/dingzhijian/.codex/visualizations/2026/07/23/019f8fb0-ac86-7f52-a0c8-930256c717bb/context-menu-qa/context-menu-comparison.png`

The Electron QA app used a 1108 × 768 light-theme viewport. The Codex
reference is a Retina crop, so the comparison normalizes the images for
hierarchy and density rather than treating raw pixel size as CSS size.

### Iteration 1

P1 findings:

- The project menu behaved like an eight-row creation palette instead of a
  project context menu.
- Create and import were repeated once per writing area, making related actions
  harder to scan.
- Sources and Skills duplicated global navigation that is already visible at
  the top of the activity rail.
- Tall rows, three separators, and generous padding made a local project action
  feel disproportionately prominent.

Root fixes:

- Group manuscript, global-information, and free-area creation under one
  `New file` submenu.
- Group the corresponding import actions under one `Import file` submenu.
- Remove duplicate Sources and Skills entries.
- Add the project-scoped Finder, new-window, and rename actions already used by
  the surrounding project-management flow.
- Match the Codex reference's compact rhythm with 28 px rows, 13 px labels,
  16 px library icons, a 6 px item radius, and a 12 px menu radius.

### Iteration 2

Electron evidence:

- The root context menu renders five scan-friendly entries with no separators.
- `New file` exposes manuscript, global-information, and free-area actions in a
  nested menu; the nested menu and its three entries are present in the live
  Electron accessibility tree.
- `Import file` uses the same grouped structure.
- Rename reuses the existing project rename dialog; Finder and new-window reuse
  the existing project-management callbacks.
- No delete action is offered for the active project.

Fidelity checks:

- Typography, colors, shadows, and icons continue to use the existing product
  system and Lucide library.
- The change borrows Codex's density and project semantics without copying its
  unrelated pin or archive actions.
- File and folder row context menus retain their existing behavior and spacing.
- No new raster assets or decorative styling were introduced.
- No P0, P1, or P2 visual or interaction differences remain.

final result: passed

## Generic file-tree creation QA — 2026-07-24

### Sources

- Reported semantic submenu:
  `/var/folders/jk/7_pcx4cd3y94_lwnf7hbxcv80000gn/T/codex-clipboard-da6da7e2-de5d-4a5e-a909-b0b0f614a914.png`
- Electron root menu:
  `/Users/dingzhijian/.codex/visualizations/2026/07/23/019f8fb0-ac86-7f52-a0c8-930256c717bb/context-menu-generic-qa/root-menu-flat.png`
- New-folder dialog:
  `/Users/dingzhijian/.codex/visualizations/2026/07/23/019f8fb0-ac86-7f52-a0c8-930256c717bb/context-menu-generic-qa/new-folder-dialog.png`
- Nested creation result:
  `/Users/dingzhijian/.codex/visualizations/2026/07/23/019f8fb0-ac86-7f52-a0c8-930256c717bb/context-menu-generic-qa/nested-file-created.png`
- Combined comparison:
  `/Users/dingzhijian/.codex/visualizations/2026/07/23/019f8fb0-ac86-7f52-a0c8-930256c717bb/context-menu-generic-qa/semantic-vs-generic-comparison.png`

The Electron QA viewport was 1400 × 900 CSS pixels at 2× screenshot density
in the product's dark theme. The reported screenshot is a light-theme crop, so
the combined comparison focuses on hierarchy, labels, and submenu behavior.

### Iteration 1

P1 findings:

- `New file` still encoded manuscript, global-information, and free-area
  destinations in a submenu, so the UI remained coupled to one writing method.
- Import used the same semantic routing instead of the directory that received
  the context-menu action.
- Creating an empty folder updated the expansion state but did not open the
  mounted React Arborist instance, so a successful creation could remain hidden.

Root fixes:

- Replace semantic creation branches with flat `New file` and `New folder`
  actions.
- Resolve create and import targets from the root or directory that was
  right-clicked.
- Keep the editable file contract explicit: `.md` and `.txt`, with `.md` as the
  default when the user omits an extension.
- Open the mounted tree node after creation or import so an empty folder is
  immediately visible.

### Iteration 2

Electron evidence:

- The project-root menu contains six flat actions with no submenu chevrons:
  `New file`, `New folder`, `Import file`, Finder, new window, and rename.
- The directory menu exposes the same three location-aware file operations
  before the existing Finder, rename, and delete operations.
- `New folder` opens a generic folder-name dialog; `New file` opens a generic
  file-name dialog.
- A root file created as `QA-新文件` appeared as `QA-新文件.md`.
- A folder created as `QA-新文件夹` accepted `目录内文件`, produced
  `QA-新文件夹/目录内文件.md`, and stayed expanded in the visible tree.
- The isolated QA project, config, and Electron profiles were moved to
  `~/.Trash/storyflow-menu-qa-20260724-35010` after verification.

Fidelity checks:

- Existing product typography, colors, shadows, menu density, and Lucide icons
  remain unchanged.
- The menu no longer exposes manuscript/global/free-area classifications.
- Creation behavior follows the native file-tree location instead of Method Pack
  semantics.
- No P0, P1, or P2 visual or interaction differences remain.

final result: passed
