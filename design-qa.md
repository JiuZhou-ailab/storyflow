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

## Directory independent collapse and panel motion QA — 2026-07-26

### Sources

- Interaction truth: the directory folds independently from the complete
  writing workspace, with a persistent toggle and horizontal slide motion.
- Expanded implementation:
  `/Users/dingzhijian/.codex/visualizations/2026/07/26/019f9df5-e400-7012-9e00-46208f788e99/ui-boundary-audit/07-directory-expanded.png`
- Collapsed implementation:
  `/Users/dingzhijian/.codex/visualizations/2026/07/26/019f9df5-e400-7012-9e00-46208f788e99/ui-boundary-audit/06-directory-collapsed.png`
- Full-view comparison:
  `/Users/dingzhijian/.codex/visualizations/2026/07/26/019f9df5-e400-7012-9e00-46208f788e99/ui-boundary-audit/08-directory-expanded-collapsed.png`
- Focused header comparison:
  `/Users/dingzhijian/.codex/visualizations/2026/07/26/019f9df5-e400-7012-9e00-46208f788e99/ui-boundary-audit/09-directory-toggle-focus.png`

Both application captures are 1339 × 768 CSS pixels at 1× density in the
same light-theme project, file, window, and DevTools-docked state.

### Iteration 1

P1 findings:

- The title-bar control owned one boolean for both manuscript and directory,
  so the directory could not be folded without also removing the manuscript.
- Right-side columns unmounted immediately, producing a hard layout jump
  instead of spatially explaining where the panels went.

Root fixes:

- Keep the title-bar control for the complete writing workspace and give the
  directory its own persisted visibility state.
- Keep the directory toggle at the right edge: inside the directory header
  while expanded, then inside the manuscript header while collapsed.
- Route manuscript, directory, and existing shell visibility changes through
  one critically damped panel spring with horizontal travel and animated width.
- Disable motion during direct sash dragging and respect reduced-motion
  preferences.

### Iteration 2

Interaction evidence:

- `收起目录` removes only the directory; the manuscript remains mounted and
  receives the released width.
- `展开目录` remains available at the manuscript's upper-right edge and
  restores the directory.
- The title-bar `收起右侧栏` / `展开右侧栏` still hides and restores both
  right-side columns.
- The directory sash was dragged 40 px and restored; width tracking remained
  attached to the pointer rather than springing behind it.

Required fidelity surfaces:

- Fonts and typography: unchanged.
- Spacing and layout rhythm: the existing 6 px gaps, 42 px headers, and outer
  right radius remain aligned in both states.
- Colors and visual tokens: the toggle reuses `HeaderIconButton` and the
  existing foreground, hover, focus, shadow, and panel tokens.
- Image quality and assets: no raster assets were added; the control reuses the
  installed Lucide panel icons.
- Copy and content: only accessible labels/tooltips `收起目录` and `展开目录`
  were added; project and manuscript content are unchanged.

Runtime evidence:

- Electron TypeScript check passes.
- Five relevant suites pass with 108 tests and 818 assertions.
- Targeted ESLint reports no errors; warnings are pre-existing hook and shared
  local-storage warnings.
- `git diff --check` passes.

No actionable P0, P1, or P2 visual or interaction differences remain.

final result: passed

## Writing panel chrome QA — 2026-07-26

### Sources

- Source visual truth:
  `/Users/dingzhijian/.codex/visualizations/2026/07/26/019f9df5-e400-7012-9e00-46208f788e99/ui-boundary-audit/01-writing-layout.png`
- Rendered implementation:
  `/Users/dingzhijian/.codex/visualizations/2026/07/26/019f9df5-e400-7012-9e00-46208f788e99/ui-boundary-audit/02-writing-layout-fixed.png`
- Full-view comparison:
  `/Users/dingzhijian/.codex/visualizations/2026/07/26/019f9df5-e400-7012-9e00-46208f788e99/ui-boundary-audit/03-before-after-full.png`
- Focused header and seam comparison:
  `/Users/dingzhijian/.codex/visualizations/2026/07/26/019f9df5-e400-7012-9e00-46208f788e99/ui-boundary-audit/04-before-after-boundaries.png`

The source capture is 1276 × 768 pixels and the implementation capture is
1277 × 768 pixels. The comparison crops one pixel from the implementation
without resampling, producing two 1276 × 768 panels. The Electron capture uses
the native desktop viewport at the same apparent CSS size and light theme.
The selected file changed from `简报.md` to `创作要求.md` between captures, so
copy and document body content are excluded from the comparison; the panel
headers, seams, outer frame, and directory state remain comparable.

### Iteration 1

P1/P2 findings:

- The outer writing row had no flex gap while each zero-width resize sash used
  negative half-gap margins, causing the manuscript and directory surfaces to
  overlap.
- A permanent 2 px sash line stacked with both panels' one-pixel shadow
  outlines, making the seam look like a doubled border.
- The manuscript header was 40 px while the shared shell header was 42 px.
- The conversation panel was incorrectly marked as the right window edge while
  the actual outer directory always used the inner radius.

Root fixes:

- Make the shared writing row own `PANEL_GAP` and remove per-column bottom
  compensation.
- Reuse the shared sash hit geometry and existing hover/drag gradient.
- Align manuscript and empty-workspace headers to the 42 px shell contract.
- Derive visible right-column state once and assign `RADIUS_EDGE` only to the
  actual outermost column.

### Iteration 2

Full-view evidence shows equal panel tops and bottoms, consistent open space
between conversation, manuscript, and directory, and no dark permanent resize
lines. The focused comparison confirms that the three title regions now share
one vertical baseline and the manuscript-directory seam no longer stacks
multiple outlines.

Required fidelity surfaces:

- Fonts and typography: font family, size, weight, wrapping, and antialiasing
  are unchanged; only the manuscript header box height moved from 40 to 42 px.
- Spacing and layout rhythm: adjacent panels now use the shared 6 px gap;
  top/bottom alignment and inner/outer radii are consistent.
- Colors and visual tokens: existing background, border, shadow, and muted
  foreground tokens are preserved.
- Image quality and assets: this shell contains no new raster or decorative
  image assets.
- Copy and content: no product copy changed; differing selected-file content is
  intentionally outside the visual comparison.

Runtime evidence:

- Electron TypeScript check passes.
- The four relevant suites pass with 104 tests and 791 assertions.
- Targeted ESLint reports no errors; the nine warnings are pre-existing
  `AppShell` hook dependency warnings outside this change.
- The implementation rendered through the existing Electron dev process
  without an HMR error overlay.
- Direct collapse/expand automation was not used as pass evidence because the
  active project/window changed during QA; the toggle implementation itself was
  not modified.

No actionable P0, P1, or P2 visual differences remain.

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
