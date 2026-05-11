# Creative Project Template System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a template-driven creative project system where selecting a novel, screenplay, or media-production template creates a consistent file structure, installs the matching skills, writes project instructions, and renders the correct workspace lens.

**Architecture:** Introduce `ProjectTemplate` and `AgentHarness` as first-class shared definitions. Workspace creation selects a template id, then a scaffold engine creates files, installs skills, writes `craft-writing.json` and `craft-template-lock.json`, and validates the result. Existing `novel` behavior remains as a backward-compatible alias for the first template, `novel.claude-book`.

**Tech Stack:** TypeScript, React, Electron RPC, shared workspace storage, built-in skills, Bun tests, i18next locale JSON.

---

## Brainstorming Summary

The system should not start with an infinite artifact-key ontology. Use templates as the product boundary:

- `ProjectTemplate` owns storage shape, required files, sidebar lens, and validation.
- `AgentHarness` owns skills, instruction files, runtime preamble, commands, and workflow gates.
- `craft-writing.json` records the selected template and harness.
- `craft-template-lock.json` records installed files and skill versions so drift can be detected and repaired.
- Skills may keep native paths when they belong to a native template. Path abstraction is added only at template boundaries, not inside every skill.

This gives a practical first version:

```text
User selects template
-> scaffold file structure
-> install matching skills
-> write AGENTS.md / CLAUDE.md / manifest / lock
-> validate required paths and skills
-> render sidebar from template lens
-> inject harness preamble before skill-driven agent work
```

## Source-Derived Templates

### Novel Template 1: `novel.claude-book`

Sources: [Claude-Book](https://github.com/ThomasHoussin/Claude-Book).

Method summary:

- Multi-agent novel workflow with planner, writer, style, character, continuity, and state update steps.
- `bible/` is permanent canon.
- `state/` is transient and versioned per chapter.
- `timeline/history.md` is append-only.
- `.work/` holds temporary drafts and review reports.

Template structure:

```text
craft-writing.json
craft-template-lock.json
AGENTS.md
CLAUDE.md
bible/
  style.md
  structure.md
  characters/
  universe/
story/
  synopsis.md
  plan.md
  chapters/
state/
  current/
    situation.md
    characters.md
    knowledge.md
  chapter-NN/
  template/
timeline/
  history.md
  current-chapter.md
analysis/
  src/
  output/
.work/
skills/
```

Harness skills:

- `book-analyzer`
- `bible-merger`
- `story-ideator`
- `chapter-workflow`
- `style-reviewer`
- `character-reviewer`
- `continuity-reviewer`
- `state-updater`

Sidebar lens:

- Manuscript: `story/chapters/`
- Outline: `story/synopsis.md`, `story/plan.md`, `bible/structure.md`
- Canon: `bible/style.md`, `bible/characters/`, `bible/universe/`
- State: `state/current/`, `state/chapter-*`
- Timeline: `timeline/`
- Analysis: `analysis/`
- Work: `.work/`
- Changes: latest turn file changes grouped by section.

### Novel Template 2: `novel.web-fiction`

Sources: [oh-story-claudecode](https://github.com/worldwonderer/oh-story-claudecode).

Method summary:

- Web-fiction production workflow for long and short online fiction.
- Separates settings, outline, manuscript, benchmark analysis, continuity tracking, and references.
- Uses specialized roles for story architecture, character design, narrative writing, consistency checking, and research.
- Strong focus on hooks, emotional arcs, genre positioning, anti-AI prose cleanup, market scanning, and benchmark deconstruction.

Template structure:

```text
craft-writing.json
craft-template-lock.json
AGENTS.md
CLAUDE.md
设定/
  世界观/
  角色/
  势力/
  关系.md
  题材定位.md
大纲/
  大纲.md
正文/
对标/
拆文库/
追踪/
  上下文.md
  伏笔.md
  时间线.md
参考资料/
.work/
skills/
```

Harness skills:

- `long-scan`
- `long-analyze`
- `long-write`
- `short-scan`
- `short-analyze`
- `short-write`
- `deslop`
- `story-review`
- `story-cover`

Sidebar lens:

- 设定
- 大纲
- 正文
- 对标
- 拆文库
- 追踪
- 参考资料
- Work

### Novel Template 3: `novel.story-lab`

Sources: [The Crucible Writing System](https://github.com/forsonny/The-Crucible-Writing-System-For-Claude), [creative-writing-skills](https://github.com/haowjy/creative-writing-skills).

Method summary:

- Combines Crucible's strong structural planning with creative-writing-skills' muse, critique, revision, and knowledge-base loop.
- Crucible contributes 36 beats, three strands, Forge Points, Mercy Engine, bi-chapter reviews, and anti-hallucination checks.
- Creative-writing-skills contributes brainstorming, style capture, scene construction, prose critique, reader simulation, chronicler, and durable `kb/` maintenance.

Template structure:

```text
craft-writing.json
craft-template-lock.json
AGENTS.md
CLAUDE.md
planning/
  crucible-thesis.md
  quest-strand.md
  fire-strand.md
  constellation-strand.md
  forge-points/
  mercy-ledger.md
  world-forge.md
outline/
  beats.md
  chapters/
story/
  chapters/
work/
  outline/
  drafts/
  critique-reports/
  brainstorm/
kb/
  styles/
  characters/
  world/
  timeline/
  canon/
  issues/
.methods/
  crucible/
    state/
skills/
```

Harness skills:

- `crucible-plan`
- `crucible-outline`
- `crucible-write`
- `crucible-edit`
- `crucible-review`
- `brainstorming`
- `style-analysis`
- `prose-writing`
- `scene-construction`
- `prose-critique`
- `kb-management`
- `writing-issues`

Sidebar lens:

- Planning
- Beats
- Manuscript
- Work
- Knowledge Base
- Issues
- Reviews

## Screenplay And Media Templates

### Screenplay Template 1: `screenplay.short-drama-adapt`

Sources: [screen-creative-skills](https://github.com/vangongwanxiaowan/screen-creative-skills), local `script-adapt` skill reference from `/Users/dingzhijian/Downloads/111/skills/script-adapt`.

Method summary:

- Pipeline for novel/IP adaptation into vertical short drama or short-form scripted episodes.
- Emphasizes IP evaluation, story analysis, character analysis, episode planning, script creation, structured JSON output, and validation.

Template structure:

```text
craft-writing.json
craft-template-lock.json
AGENTS.md
CLAUDE.md
workspace/
  source.txt
  draft/
    source-structure.json
    design.json
    catalog.json
    connectivity.md
    episodes/
output/
  script.json
reports/
  evaluation/
  validation/
skills/
```

Harness skills:

- `script-adapt`
- `novel-summarizer`
- `novel-evaluator`
- `drama-planner`
- `drama-creator`
- `drama-evaluator`
- `score-analyzer`

Sidebar lens:

- Source
- Design
- Catalog
- Episodes
- Validation
- Output

### Screenplay Template 2: `screenplay.short-film`

Sources: [screenwriter skill](https://github.com/majiayu000/claude-skill-registry/tree/main/skills/data/screenwriter).

Method summary:

- Converts raw concepts into 5-10 minute short-film screenplays.
- Uses scene breakdown, visual-rich action writing, screenplay formatting, and XML-tagged markdown output for AI image/video pipelines.

Template structure:

```text
craft-writing.json
craft-template-lock.json
AGENTS.md
CLAUDE.md
brief/
  concept.md
  constraints.md
screenplay/
  scene-breakdown.md
  script.md
  script.xml.md
visuals/
  characters.md
  locations.md
  key-visuals.md
metadata/
  scene-metadata.json
work/
  drafts/
  revisions/
skills/
```

Harness skills:

- `screenwriter`
- `scene-breakdown`
- `visual-enhancer`
- `format-validator`

Sidebar lens:

- Brief
- Scene Breakdown
- Screenplay
- Visuals
- Metadata
- Work

### Screenplay Template 3: `media.ai-video-pilot`

Sources: [Codeywood](https://github.com/kaigani/codeywood), [Story Systems Template](https://github.com/bybren-llc/story-systems-template).

Method summary:

- AI filmmaking pipeline from story intake to story bible, screenplay, reference library, shot list, generated shots, and visual QA.
- Codeywood emphasizes skill dependencies, concrete output files, quality gates, reference-based visual consistency, and a staged pipeline.
- Story Systems Template emphasizes a multi-AI creative team with authority boundaries and approval gates.

Template structure:

```text
craft-writing.json
craft-template-lock.json
AGENTS.md
CLAUDE.md
story/
  CREATIVE_BRIEF.md
  POWER_STACK.md
  LOGLINE_LOCK.md
  SHOW_BIBLE.md
characters/
  CHARACTER_SHEETS/
  RELATIONSHIP_MAP.json
episodes/
  EP##_BEATS.md
  EP##_SCENELIST.md
  SCRIPT_EP##.md
canon/
  CANON_DB.json
  STYLEGUIDE_VISUAL.md
references/
  characters/
  locations/
  props/
shots/
  shot-lists/
  generated/
qa/
  CRITIQUE_REPORT.md
  CONTINUITY_REPORT.md
  SHOT_QA_REPORT_EP##.md
skills/
```

Harness skills:

- `story-intake`
- `logline-architect`
- `character-architect`
- `story-architect`
- `screenplay-writer`
- `dialogue-doctor`
- `story-critic`
- `bible-keeper`
- `canon-database-manager`
- `visual-style-guide`
- `shot-list-generator`
- `shot-quality-validator`
- `workflow-orchestrator`

Sidebar lens:

- Story Foundation
- Characters
- Episodes
- Canon
- References
- Shots
- QA

## Task 1: Define Template And Harness Types

**Files:**
- Create: `packages/shared/src/writing/templates/types.ts`
- Create: `packages/shared/src/writing/templates/index.ts`
- Modify: `packages/shared/src/writing/index.ts`
- Modify: `packages/shared/package.json`
- Test: `packages/shared/src/writing/templates/__tests__/types.test.ts`

**Step 1: Write the failing test**

Create tests that assert a template can describe:

- `id`, `version`, `type`, `storageProfile`
- required paths
- scaffold files
- skill slugs
- sidebar sections
- harness id and instruction files

**Step 2: Run the test to verify it fails**

Run:

```bash
cd packages/shared && bun test src/writing/templates/__tests__/types.test.ts
```

Expected: FAIL because `templates/types.ts` does not exist.

**Step 3: Implement minimal types**

Add:

```ts
export type CreativeProjectType = "general" | "novel" | "screenplay" | "media";

export interface TemplatePathSpec {
  path: string;
  kind: "file" | "directory";
  required: boolean;
}

export interface TemplateScaffoldFile {
  path: string;
  content: string;
  overwrite: false;
}

export interface TemplateSkillSpec {
  slug: string;
  source: "builtin" | "template";
  required: boolean;
}

export interface TemplateSidebarSection {
  id: string;
  titleKey: string;
  include: string[];
}

export interface AgentHarnessSpec {
  id: string;
  version: number;
  skills: TemplateSkillSpec[];
  instructionFiles: TemplateScaffoldFile[];
  runtimePreamble: string;
}

export interface ProjectTemplate {
  id: string;
  version: number;
  type: CreativeProjectType;
  labelKey: string;
  descriptionKey: string;
  storageProfile: string;
  requiredPaths: TemplatePathSpec[];
  scaffoldFiles: TemplateScaffoldFile[];
  sidebar: TemplateSidebarSection[];
  harness: AgentHarnessSpec;
}
```

**Step 4: Export the module**

Add exports:

```ts
export * from "./templates/index.ts";
```

And package export:

```json
"./writing/templates": "./src/writing/templates/index.ts"
```

**Step 5: Run tests**

Run:

```bash
cd packages/shared && bun test src/writing/templates/__tests__/types.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/shared/src/writing/templates packages/shared/src/writing/index.ts packages/shared/package.json
git commit -m "feat: add creative project template types"
```

## Task 2: Add Built-In Template Registry

**Files:**
- Create: `packages/shared/src/writing/templates/builtin.ts`
- Create: `packages/shared/src/writing/templates/template-content.ts`
- Test: `packages/shared/src/writing/templates/__tests__/builtin.test.ts`

**Step 1: Write the failing tests**

Cover:

- registry contains six templates:
  - `novel.claude-book`
  - `novel.web-fiction`
  - `novel.story-lab`
  - `screenplay.short-drama-adapt`
  - `screenplay.short-film`
  - `media.ai-video-pilot`
- every template has at least one required path.
- every template has at least one required skill.
- `novel.claude-book` includes `state/current/situation.md`.

**Step 2: Run the test to verify it fails**

Run:

```bash
cd packages/shared && bun test src/writing/templates/__tests__/builtin.test.ts
```

Expected: FAIL because the registry does not exist.

**Step 3: Implement registry lookup**

Add:

```ts
export const BUILTIN_PROJECT_TEMPLATES: ProjectTemplate[] = [
  claudeBookTemplate,
  webFictionTemplate,
  storyLabTemplate,
  shortDramaAdaptTemplate,
  shortFilmTemplate,
  aiVideoPilotTemplate,
];

export function listProjectTemplates(): ProjectTemplate[];
export function getProjectTemplate(id: string): ProjectTemplate | null;
```

Use short placeholder file contents for non-Claude-Book templates. Keep the first implementation intentionally small; templates can evolve after the registry exists.

**Step 4: Run tests**

Run:

```bash
cd packages/shared && bun test src/writing/templates/__tests__/builtin.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/writing/templates
git commit -m "feat: add built-in creative project templates"
```

## Task 3: Create Template Scaffold Engine

**Files:**
- Create: `packages/shared/src/writing/templates/scaffold.ts`
- Create: `packages/shared/src/writing/templates/lock.ts`
- Test: `packages/shared/src/writing/templates/__tests__/scaffold.test.ts`

**Step 1: Write failing tests**

Cover:

- `createProjectFromTemplate(rootPath, name, templateId)` creates required files and directories.
- existing user-authored files are not overwritten.
- `craft-writing.json` includes `template.id`, `template.version`, `storageProfile`, and `harness.id`.
- `craft-template-lock.json` includes installed required skills.

**Step 2: Run the test to verify it fails**

Run:

```bash
cd packages/shared && bun test src/writing/templates/__tests__/scaffold.test.ts
```

Expected: FAIL.

**Step 3: Implement scaffold engine**

Implementation rules:

- Create directories recursively.
- Write files only when missing.
- Always write manifest and lock through atomic writes.
- Install skills into `skills/<slug>/SKILL.md`.
- Write instruction files from harness, usually `AGENTS.md` and `CLAUDE.md`.

**Step 4: Run tests**

Run:

```bash
cd packages/shared && bun test src/writing/templates/__tests__/scaffold.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/writing/templates
git commit -m "feat: scaffold creative projects from templates"
```

## Task 4: Add Template Validation And Repair

**Files:**
- Create: `packages/shared/src/writing/templates/validation.ts`
- Test: `packages/shared/src/writing/templates/__tests__/validation.test.ts`

**Step 1: Write failing tests**

Cover:

- valid scaffold returns no missing required paths.
- deleted skill returns a missing skill finding.
- deleted required path returns a missing path finding.
- repair recreates missing scaffold files without overwriting existing files.

**Step 2: Run test to verify it fails**

Run:

```bash
cd packages/shared && bun test src/writing/templates/__tests__/validation.test.ts
```

Expected: FAIL.

**Step 3: Implement validation**

Add:

```ts
export interface TemplateValidationFinding {
  severity: "error" | "warning";
  code: string;
  path?: string;
  message: string;
}

export function validateProjectTemplate(rootPath: string, template: ProjectTemplate): TemplateValidationFinding[];
export function repairProjectTemplate(rootPath: string, template: ProjectTemplate): TemplateValidationFinding[];
```

**Step 4: Run tests**

Run:

```bash
cd packages/shared && bun test src/writing/templates/__tests__/validation.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/writing/templates/validation.ts packages/shared/src/writing/templates/__tests__/validation.test.ts
git commit -m "feat: validate creative project templates"
```

## Task 5: Replace Workspace `projectType` With Template Selection

**Files:**
- Modify: `apps/electron/src/shared/types.ts`
- Modify: `packages/server-core/src/handlers/rpc/workspace-creation.ts`
- Modify: `packages/server-core/src/handlers/rpc/workspace.ts`
- Modify: `packages/shared/src/workspaces/storage.ts`
- Test: `packages/server-core/src/handlers/rpc/workspace-creation.test.ts`
- Test: `packages/shared/src/workspaces/__tests__/storage-novel-template.test.ts`

**Step 1: Write failing tests**

Cover:

- `{ templateId: "novel.claude-book" }` creates a Claude-Book project.
- legacy `{ projectType: "novel" }` maps to `templateId: "novel.claude-book"`.
- general workspace creates no writing scaffold.

**Step 2: Run tests**

Run:

```bash
bun test packages/server-core/src/handlers/rpc/workspace-creation.test.ts packages/shared/src/workspaces/__tests__/storage-novel-template.test.ts
```

Expected: FAIL.

**Step 3: Implement compatibility layer**

Add:

```ts
export type WorkspaceTemplateId =
  | "general"
  | "novel.claude-book"
  | "novel.web-fiction"
  | "novel.story-lab"
  | "screenplay.short-drama-adapt"
  | "screenplay.short-film"
  | "media.ai-video-pilot";
```

Update create options:

```ts
export interface CreateWorkspaceOptions {
  remoteServer?: CoreRemoteServerConfig;
  projectType?: WorkspaceProjectType;
  templateId?: WorkspaceTemplateId;
}
```

Map:

```ts
projectType === "novel" -> templateId = "novel.claude-book"
```

**Step 4: Run tests**

Run:

```bash
bun test packages/server-core/src/handlers/rpc/workspace-creation.test.ts packages/shared/src/workspaces/__tests__/storage-novel-template.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/electron/src/shared/types.ts packages/server-core/src/handlers/rpc/workspace-creation.ts packages/server-core/src/handlers/rpc/workspace.ts packages/shared/src/workspaces/storage.ts packages/server-core/src/handlers/rpc/workspace-creation.test.ts packages/shared/src/workspaces/__tests__/storage-novel-template.test.ts
git commit -m "feat: create workspaces from project templates"
```

## Task 6: Add Template Picker To Workspace Creation UI

**Files:**
- Modify: `apps/electron/src/renderer/components/workspace/AddWorkspaceStep_CreateNew.tsx`
- Modify: `apps/electron/src/renderer/components/workspace/WorkspaceCreationScreen.tsx`
- Modify: `packages/shared/src/i18n/locales/en.json`
- Modify: `packages/shared/src/i18n/locales/zh-Hans.json`
- Test: existing renderer tests if available; otherwise add lightweight unit tests for template option mapping.

**Step 1: Write failing test**

Add a pure helper in a new file:

- Create: `apps/electron/src/renderer/components/workspace/template-options.ts`
- Test: `apps/electron/src/renderer/components/workspace/__tests__/template-options.test.ts`

Test that the UI options include `General`, three novel templates, and three screenplay/media templates.

**Step 2: Run test**

Run:

```bash
bun test apps/electron/src/renderer/components/workspace/__tests__/template-options.test.ts
```

Expected: FAIL.

**Step 3: Implement template option helper and UI**

Replace two radio options with grouped template cards:

- General
- Novel
  - Claude-Book Native
  - Web Fiction Production
  - Story Lab
- Screenplay / Media
  - Short Drama Adaptation
  - Short Film Screenplay
  - AI Video Pilot

**Step 4: Run tests**

Run:

```bash
bun test apps/electron/src/renderer/components/workspace/__tests__/template-options.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/electron/src/renderer/components/workspace packages/shared/src/i18n/locales/en.json packages/shared/src/i18n/locales/zh-Hans.json
git commit -m "feat: add creative template picker"
```

## Task 7: Drive Sidebar Lens From Template Metadata

**Files:**
- Create: `apps/electron/src/renderer/lib/template-workspace.ts`
- Modify: `apps/electron/src/renderer/lib/writing-workspace.ts`
- Modify: `apps/electron/src/renderer/components/app-shell/AppShell.tsx`
- Test: `apps/electron/src/renderer/lib/__tests__/template-workspace.test.ts`

**Step 1: Write failing tests**

Cover:

- `novel.claude-book` groups `bible/style.md` under Canon.
- `screenplay.short-drama-adapt` groups `workspace/draft/episodes/ep01.md` under Episodes.
- unknown files fall into Other.

**Step 2: Run tests**

Run:

```bash
bun test apps/electron/src/renderer/lib/__tests__/template-workspace.test.ts
```

Expected: FAIL.

**Step 3: Implement template lens projection**

Build:

```ts
export function buildTemplateWorkspaceTree(files, template): TemplateWorkspaceTree;
```

Keep existing novel logic as a wrapper around `novel.claude-book` until AppShell migration is complete.

**Step 4: Run tests**

Run:

```bash
bun test apps/electron/src/renderer/lib/__tests__/template-workspace.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/electron/src/renderer/lib/template-workspace.ts apps/electron/src/renderer/lib/writing-workspace.ts apps/electron/src/renderer/components/app-shell/AppShell.tsx apps/electron/src/renderer/lib/__tests__/template-workspace.test.ts
git commit -m "feat: render creative workspaces from template lens"
```

## Task 8: Add Harness Runtime Preamble

**Files:**
- Create: `packages/shared/src/writing/templates/harness-runtime.ts`
- Modify: `packages/shared/src/agent/base-agent.ts` or the current prompt assembly point after confirming exact call path
- Test: add nearest agent prompt assembly test.

**Step 1: Locate prompt assembly**

Use `rg` to find where workspace skills and project files are included in agent context.

**Step 2: Write failing test**

Assert that a workspace with `template.id = "novel.claude-book"` injects:

```text
Current project template: novel.claude-book
Use bible/ as canon.
Use story/chapters/ as manuscript.
Use state/current/ as current continuity state.
```

**Step 3: Implement runtime preamble**

Add:

```ts
export function buildHarnessRuntimePreamble(template: ProjectTemplate): string;
```

Inject it once per agent session when a template is detected.

**Step 4: Run focused tests**

Run the new test plus existing agent prompt tests.

**Step 5: Commit**

```bash
git add packages/shared/src/writing/templates/harness-runtime.ts packages/shared/src/agent
git commit -m "feat: inject creative template harness context"
```

## Task 9: Add Template Status And Repair UI

**Files:**
- Create: `apps/electron/src/renderer/components/workspace/TemplateStatusPanel.tsx`
- Modify: workspace settings page or writing workspace header after choosing final placement.
- Add IPC/RPC handler if validation must run in main process.

**Step 1: Write shared validation tests first**

Use Task 4 validation coverage as the source of truth.

**Step 2: Add UI display**

Display:

- Template id/version
- Missing required paths
- Missing required skills
- Repair action

**Step 3: Add repair action**

Repair must call shared `repairProjectTemplate`.

**Step 4: Run focused tests**

Run renderer tests and shared validation tests.

**Step 5: Commit**

```bash
git add apps/electron/src/renderer/components/workspace packages/shared/src/writing/templates
git commit -m "feat: show creative template status"
```

## Task 10: Verification

**Files:**
- No new files unless failures require fixes.

**Step 1: Run shared writing tests**

```bash
cd packages/shared && bun test src/writing src/workspaces/__tests__/storage-novel-template.test.ts
```

Expected: PASS.

**Step 2: Run server workspace tests**

```bash
bun test packages/server-core/src/handlers/rpc/workspace-creation.test.ts
```

Expected: PASS.

**Step 3: Run renderer template tests**

```bash
bun test apps/electron/src/renderer/lib/__tests__/template-workspace.test.ts apps/electron/src/renderer/components/workspace/__tests__/template-options.test.ts
```

Expected: PASS.

**Step 4: Manual smoke test**

Create one workspace for:

- `novel.claude-book`
- `screenplay.short-drama-adapt`

Confirm:

- required folders exist.
- required skills exist.
- manifest and lock exist.
- sidebar sections match the selected template.
- missing file repair restores deleted required files.

**Step 5: Commit final fixes**

```bash
git status --short
git add <changed-files>
git commit -m "test: verify creative project templates"
```
