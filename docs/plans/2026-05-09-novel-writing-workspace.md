# Novel Writing Workspace Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn Craft Agent into a first-class novel writing workspace, using Claude-Book as a reference for project structure, skills, and chapter workflow while leaving room for future screenplay-specific skills.

**Architecture:** Add a domain-neutral writing project layer that detects a project manifest and maps files into writing concepts; implement `novel` as the first profile instead of hard-coding novel assumptions into generic chat. Seed novel workspaces with Claude-Book-derived structure and skills, then render a dedicated writing workspace where the chat is available as a compact top dropdown/tab and the main surface shows manuscript, outline, bible, state, timeline, and semantic changes.

**Tech Stack:** TypeScript, React, Electron IPC, Jotai/AppShell context, Bun test, existing Craft Agent skills storage, existing `collectFileChangesFromActivities` diff extraction, i18next locale JSON.

---

## Reference Constraints

- Claude-Book source: `https://github.com/ThomasHoussin/Claude-Book`, current inspected HEAD `3fdebbb576b1be6d123b48258d2310c5dff013c4`.
- Claude-Book license: MIT. This repository is Apache-2.0, so copied or adapted skill text must carry attribution and a notice.
- Do not depend on Claude Code `.claude/agents/*` at runtime. Craft Agent currently loads skills through `SKILL.md` via `packages/shared/src/agent/base-agent.ts`, and `packages/shared/src/agent/claude-agent.ts` sets SDK `plugins: []`.
- Preserve a future `screenplay` lane by using `WritingProjectType` and manifest-driven behavior instead of naming everything `Novel*` in shared business logic.
- Use @test-driven-development for implementation tasks, @frontend-design for the UI task, and @verification-before-completion before final handoff.

## Target UX

- The main session panel should stop being conversation-first for writing projects.
- A novel project opens as a writing workspace:
  - Top compact conversation tab/dropdown: recent assistant/user turns, command input, model/skill controls, and a clear route back to full chat if needed.
  - Main workspace: persistent tabs for `Manuscript`, `Outline`, `Characters`, `Locations`, `State`, `Timeline`, `Changes`.
  - `Changes` groups the current turn's edits by writing meaning, not raw file path only.
- Users should immediately see what changed in the novel: characters, locations, outline, state, timeline, and manuscript.

## File Contract

The initial `novel` profile should understand this structure:

```text
craft-writing.json
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
  chapter-NN/
  template/
timeline/
  history.md
  current-chapter.md
analysis/
  src/
  output/
.work/
```

`bible/` should be treated as canon, not casually edited during chapter drafting. `state/` is mutable and versioned. `timeline/history.md` is append-only at chapter transition.

---

### Task 1: Add Writing Project Manifest And Detection

**Files:**
- Create: `packages/shared/src/writing/types.ts`
- Create: `packages/shared/src/writing/manifest.ts`
- Create: `packages/shared/src/writing/index.ts`
- Modify: `packages/shared/package.json`
- Test: `packages/shared/src/writing/__tests__/manifest.test.ts`

**Step 1: Write the failing tests**

Create tests for:
- `detectWritingProject(rootPath)` returns `null` without `craft-writing.json`.
- A valid novel manifest returns type `novel` and canonical directories.
- Missing manifest still detects Claude-Book-compatible structure when `bible/`, `story/`, `state/`, and `timeline/` exist.
- Invalid project type is ignored safely.

```ts
import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { detectWritingProject } from "../manifest";

function tmpProject() {
  return mkdtempSync(join(tmpdir(), "craft-writing-"));
}

describe("detectWritingProject", () => {
  it("returns null when no writing manifest or structure exists", () => {
    expect(detectWritingProject(tmpProject())).toBeNull();
  });

  it("loads a novel manifest", () => {
    const root = tmpProject();
    writeFileSync(join(root, "craft-writing.json"), JSON.stringify({
      schemaVersion: 1,
      type: "novel",
      language: "zh-Hans",
      title: "Test Novel",
    }));

    expect(detectWritingProject(root)?.type).toBe("novel");
  });

  it("detects Claude-Book-compatible novel structure without a manifest", () => {
    const root = tmpProject();
    for (const dir of ["bible", "story", "state", "timeline"]) {
      mkdirSync(join(root, dir), { recursive: true });
    }

    const project = detectWritingProject(root);
    expect(project?.type).toBe("novel");
    expect(project?.source).toBe("structure");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/shared && bun test src/writing/__tests__/manifest.test.ts`

Expected: FAIL because `../manifest` does not exist.

**Step 3: Implement the minimal shared domain layer**

Add:

```ts
export type WritingProjectType = "novel" | "screenplay";

export interface WritingProjectManifest {
  schemaVersion: 1;
  type: WritingProjectType;
  title?: string;
  language?: string;
  profile?: string;
}

export interface DetectedWritingProject {
  type: WritingProjectType;
  source: "manifest" | "structure";
  rootPath: string;
  manifest: WritingProjectManifest;
  directories: {
    bible?: string;
    story?: string;
    state?: string;
    timeline?: string;
    analysis?: string;
    work?: string;
  };
}
```

In `manifest.ts`, use `existsSync`, `readFileSync`, and `JSON.parse`. Do not use fuzzy keyword detection; only trust explicit manifest or the full Claude-Book-compatible directory quartet.

**Step 4: Export the module**

Add an export in `packages/shared/package.json`:

```json
"./writing": "./src/writing/index.ts"
```

**Step 5: Run tests**

Run: `cd packages/shared && bun test src/writing/__tests__/manifest.test.ts`

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/shared/src/writing packages/shared/package.json
git commit -m "feat: add writing project manifest detection"
```

---

### Task 2: Categorize Novel Files Into Workspace Sections

**Files:**
- Create: `packages/shared/src/writing/file-categories.ts`
- Test: `packages/shared/src/writing/__tests__/file-categories.test.ts`

**Step 1: Write the failing tests**

Cover these mappings:
- `story/chapters/chapter-01.md` -> `manuscript`
- `story/plan.md` and `story/synopsis.md` -> `outline`
- `bible/characters/alice.md` -> `characters`
- `bible/universe/paris.md` -> `locations`
- `state/current/situation.md` -> `state`
- `timeline/history.md` -> `timeline`
- anything under `.work/` -> `work`

**Step 2: Run test to verify it fails**

Run: `cd packages/shared && bun test src/writing/__tests__/file-categories.test.ts`

Expected: FAIL because the module does not exist.

**Step 3: Implement a small deterministic classifier**

Use path segment matching, not substring guessing:

```ts
export type WritingFileCategory =
  | "manuscript"
  | "outline"
  | "characters"
  | "locations"
  | "style"
  | "state"
  | "timeline"
  | "analysis"
  | "work"
  | "other";
```

Normalize separators to `/`. Keep the function pure:

```ts
export function categorizeNovelPath(relativePath: string): WritingFileCategory;
```

**Step 4: Run tests**

Run: `cd packages/shared && bun test src/writing/__tests__/file-categories.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/writing/file-categories.ts packages/shared/src/writing/__tests__/file-categories.test.ts
git commit -m "feat: categorize novel workspace files"
```

---

### Task 3: Add Novel Workspace Scaffold And License Notice

**Files:**
- Create: `packages/shared/src/writing/novel-template.ts`
- Create: `packages/shared/src/writing/claude-book-notice.ts`
- Modify: `packages/shared/src/workspaces/storage.ts`
- Test: `packages/shared/src/writing/__tests__/novel-template.test.ts`
- Test: `packages/shared/src/workspaces/__tests__/storage-novel-template.test.ts`

**Step 1: Write scaffold tests**

Test that `createNovelProjectScaffold(rootPath, options)` creates:
- `craft-writing.json`
- `bible/style.md`
- `bible/structure.md`
- `bible/characters/_template.md`
- `bible/universe/_template.md`
- `story/synopsis.md`
- `story/plan.md`
- `story/chapters/.gitkeep`
- `state/template/situation.md`
- `state/template/characters.md`
- `state/template/knowledge.md`
- `timeline/history.md`
- `timeline/current-chapter.md`
- `.work/.gitkeep`
- `NOTICE-Claude-Book.md`

**Step 2: Run test to verify it fails**

Run: `cd packages/shared && bun test src/writing/__tests__/novel-template.test.ts`

Expected: FAIL because scaffold code does not exist.

**Step 3: Implement scaffold**

Add `createNovelProjectScaffold(rootPath, options)` with idempotent directory creation. Keep template text minimal and user-editable. Do not overwrite user files if they already exist.

The notice must include:

```text
Portions of the novel writing structure and skill concepts are adapted from Claude-Book.
Source: https://github.com/ThomasHoussin/Claude-Book
License: MIT
Inspected revision: 3fdebbb576b1be6d123b48258d2310c5dff013c4
```

**Step 4: Add workspace creation hook without changing existing behavior**

Extend `CreateWorkspaceInput` and `createWorkspaceAtPath` only if there is already a typed path for workspace creation options. Otherwise create a separate exported helper:

```ts
export function createNovelWorkspaceAtPath(rootPath: string, name: string): WorkspaceConfig {
  const config = createWorkspaceAtPath(rootPath, name);
  createNovelProjectScaffold(rootPath, { title: name });
  return config;
}
```

Avoid silently making every workspace a novel workspace.

**Step 5: Run tests**

Run: `cd packages/shared && bun test src/writing/__tests__/novel-template.test.ts src/workspaces/__tests__/storage-novel-template.test.ts`

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/shared/src/writing packages/shared/src/workspaces
git commit -m "feat: add novel workspace scaffold"
```

---

### Task 4: Add Novel System Prompt Profile

**Files:**
- Modify: `packages/shared/src/prompts/system.ts`
- Test: `packages/shared/src/prompts/__tests__/system-novel.test.ts`

**Step 1: Write the failing tests**

Tests should assert:
- `SystemPromptPreset` accepts `novel`.
- `getSystemPrompt(..., "novel", ...)` includes the base Craft Agent capabilities.
- The novel prompt includes durable writing rules:
  - preserve manuscript content unless user asks to rewrite
  - treat `bible/` as canon
  - keep `state/` and `timeline/` updated after accepted chapter changes
  - surface semantic changes to characters, locations, outline, state, timeline, manuscript
  - use skills when mentioned
- The `mini` preset remains unchanged.

**Step 2: Run test to verify it fails**

Run: `cd packages/shared && bun test src/prompts/__tests__/system-novel.test.ts`

Expected: FAIL because `novel` is not a valid preset.

**Step 3: Implement the prompt profile**

Change:

```ts
export type SystemPromptPreset = "default" | "mini" | "novel";
```

Add a small append-only profile function:

```ts
function getNovelWritingProfilePrompt(): string {
  return `

## Novel Writing Workspace

This session is operating inside a novel writing project.

Primary rules:
- Treat manuscript prose and bible files as first-class user content. Preserve exact wording unless the user explicitly asks for edits.
- Treat \`bible/\` as canon for style, characters, structure, and universe facts.
- Treat \`story/\` as the manuscript and planning layer.
- Treat \`state/\` and \`timeline/\` as continuity records that must be updated after accepted chapter-level changes.
- Before drafting or revising chapters, read the relevant bible, outline, current state, and timeline files.
- When reporting changes, group them by manuscript, outline, characters, locations, state, timeline, and working notes.
- Prefer project or workspace skills for domain-specific writing workflows.
`;
}
```

Append this profile to `basePrompt` when `preset === "novel"`; do not fork the entire generic prompt.

**Step 4: Run tests**

Run: `cd packages/shared && bun test src/prompts/__tests__/system-novel.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/prompts/system.ts packages/shared/src/prompts/__tests__/system-novel.test.ts
git commit -m "feat: add novel writing system prompt"
```

---

### Task 5: Import Claude-Book-Derived Skills As Craft Skills

**Files:**
- Create: `packages/shared/src/writing/skills/novel/book-analyzer/SKILL.md`
- Create: `packages/shared/src/writing/skills/novel/bible-merger/SKILL.md`
- Create: `packages/shared/src/writing/skills/novel/story-ideator/SKILL.md`
- Create: `packages/shared/src/writing/skills/novel/chapter-workflow/SKILL.md`
- Create: `packages/shared/src/writing/skills/novel/style-reviewer/SKILL.md`
- Create: `packages/shared/src/writing/skills/novel/character-reviewer/SKILL.md`
- Create: `packages/shared/src/writing/skills/novel/continuity-reviewer/SKILL.md`
- Create: `packages/shared/src/writing/skills/novel/state-updater/SKILL.md`
- Create: `packages/shared/src/writing/skills/novel/NOTICE.md`
- Modify: `packages/shared/src/writing/novel-template.ts`
- Test: `packages/shared/src/writing/__tests__/novel-skills.test.ts`

**Step 1: Write failing tests**

Assert that seeded skills:
- Have valid frontmatter with `name` and `description`.
- Use Craft skill structure, not Claude `.claude/agents` frontmatter.
- Include attribution notice.
- Do not include hardcoded `Output language: French`; language should be manifest/user driven.
- Mark perplexity analysis as optional instead of a default gate.

**Step 2: Run test to verify it fails**

Run: `cd packages/shared && bun test src/writing/__tests__/novel-skills.test.ts`

Expected: FAIL because skills are not present.

**Step 3: Adapt skills**

Use Claude-Book as a concept source, but rewrite for Craft:
- `book-analyzer`: evidence-based extraction into `analysis/output/<book>/`.
- `bible-merger`: merge multiple analyses into canonical `bible/`.
- `story-ideator`: generate original plot seeds and anti-plagiarism checks.
- `chapter-workflow`: productized orchestrator that describes the sequential workflow in one skill. It should call or instruct the current agent to use planner/writer/reviewer skills; it must not assume Claude Code subagents are available.
- `style-reviewer`, `character-reviewer`, `continuity-reviewer`, `state-updater`: adapted from Claude-Book agents into executable Craft skills.

Do not import `perplexity-improver` as a default skill in this phase. Add a note in `NOTICE.md` that the original Claude-Book skill depends on local GPU/CUDA and should be added later as an optional advanced capability.

**Step 4: Seed skills into novel workspace template**

`createNovelProjectScaffold` should copy these skill folders into:

```text
skills/<skill-slug>/SKILL.md
skills/NOTICE-Claude-Book.md
```

Use non-overwriting writes.

**Step 5: Run tests**

Run: `cd packages/shared && bun test src/writing/__tests__/novel-skills.test.ts src/writing/__tests__/novel-template.test.ts`

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/shared/src/writing
git commit -m "feat: seed novel writing skills"
```

---

### Task 6: Wire Novel Profile Into Session Creation

**Files:**
- Modify: `packages/shared/src/agent/base-agent.ts`
- Modify: `packages/shared/src/agent/claude-agent.ts`
- Modify: `packages/shared/src/sessions/types.ts` or the actual session type file if different
- Modify: `apps/electron/src/main/handlers/workspace.ts` or the current workspace/session creation handler
- Test: `packages/shared/src/agent/__tests__/novel-prompt-profile.test.ts`

**Step 1: Locate the current preset path**

Search for calls to `getSystemPrompt(` and where session options are converted into agent configuration.

Run: `rg -n "getSystemPrompt\\(|systemPromptPreset|preset" packages apps`

Expected: identify the single path that chooses `default` vs `mini`.

**Step 2: Write failing tests**

Test that when `workingDirectory` points to a detected novel project, the agent prompt preset resolves to `novel`; normal projects still resolve to `default`.

**Step 3: Implement profile resolution**

Add a pure helper near agent/session config:

```ts
export function resolveSystemPromptPresetForWorkingDirectory(workingDirectory?: string): SystemPromptPreset {
  if (!workingDirectory) return "default";
  return detectWritingProject(workingDirectory)?.type === "novel" ? "novel" : "default";
}
```

Use it only for full user sessions. Do not change mini agents.

**Step 4: Run tests**

Run: `cd packages/shared && bun test src/agent/__tests__/novel-prompt-profile.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/agent packages/shared/src/sessions
git commit -m "feat: resolve novel prompt profile from workspace"
```

---

### Task 7: Build Workspace Snapshot Helpers For UI

**Files:**
- Create: `apps/electron/src/renderer/lib/writing-workspace.ts`
- Test: `apps/electron/src/renderer/lib/__tests__/writing-workspace.test.ts`

**Step 1: Write failing tests**

Cover pure helpers:
- `buildNovelWorkspaceTree(files)` groups files into the seven UI sections.
- `selectDefaultNovelTab(snapshot)` prefers `manuscript` when chapters exist, otherwise `outline`.
- `summarizeNovelSection(files)` returns counts and latest modified time if metadata is available.
- `groupNovelFileChanges(changes)` uses shared category logic to group raw diffs.

**Step 2: Run test to verify it fails**

Run: `cd apps/electron && bun test src/renderer/lib/__tests__/writing-workspace.test.ts`

Expected: FAIL.

**Step 3: Implement helpers**

Use `categorizeNovelPath` from `@craft-agent/shared/writing`. Keep these functions side-effect free so UI can be tested without Electron.

**Step 4: Run tests**

Run: `cd apps/electron && bun test src/renderer/lib/__tests__/writing-workspace.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/electron/src/renderer/lib/writing-workspace.ts apps/electron/src/renderer/lib/__tests__/writing-workspace.test.ts
git commit -m "feat: add writing workspace UI helpers"
```

---

### Task 8: Render Novel Workspace Panel

**Files:**
- Create: `apps/electron/src/renderer/components/writing/NovelWorkspacePanel.tsx`
- Create: `apps/electron/src/renderer/components/writing/NovelWorkspaceTabs.tsx`
- Create: `apps/electron/src/renderer/components/writing/NovelSectionList.tsx`
- Create: `apps/electron/src/renderer/components/writing/NovelDocumentPreview.tsx`
- Modify: `apps/electron/src/renderer/pages/ChatPage.tsx`
- Test: `apps/electron/src/renderer/components/writing/__tests__/NovelWorkspacePanel.test.tsx`

**Step 1: Write component tests**

Use the repo's existing React test pattern. Assert:
- All tabs render: `Manuscript`, `Outline`, `Characters`, `Locations`, `State`, `Timeline`, `Changes`.
- Empty sections show a compact empty state.
- Clicking a file invokes `onOpenFile(path)`.
- `Changes` renders grouped categories from raw file changes.

**Step 2: Run test to verify it fails**

Run: `cd apps/electron && bun test src/renderer/components/writing/__tests__/NovelWorkspacePanel.test.tsx`

Expected: FAIL.

**Step 3: Implement panel**

Design constraints:
- No nested cards.
- Dense, editor-like surface.
- Use tabs for sections.
- Use icon buttons with lucide icons where appropriate.
- Keep file rows stable height.
- Preview markdown through existing `Markdown` or a small read-only preview; if full file content loading is not ready, show structured file lists first and open files through existing `onOpenFile`.

**Step 4: Run tests**

Run: `cd apps/electron && bun test src/renderer/components/writing/__tests__/NovelWorkspacePanel.test.tsx`

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/electron/src/renderer/components/writing apps/electron/src/renderer/pages/ChatPage.tsx
git commit -m "feat: render novel workspace panel"
```

---

### Task 9: Convert Chat To Top Dropdown For Writing Projects

**Files:**
- Create: `apps/electron/src/renderer/components/writing/WritingChatDropdown.tsx`
- Modify: `apps/electron/src/renderer/pages/ChatPage.tsx`
- Modify: `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx`
- Modify: `apps/electron/src/renderer/components/app-shell/input/ChatInputZone.tsx` only if a compact top mode needs explicit sizing
- Test: `apps/electron/src/renderer/components/writing/__tests__/WritingChatDropdown.test.tsx`

**Step 1: Write failing tests**

Assert:
- In a novel project, `ChatPage` renders `NovelWorkspacePanel` as the main body.
- The chat transcript/input is accessible through a top dropdown/tab.
- The dropdown does not occupy the main workspace when closed.
- Existing non-writing sessions still render the normal `ChatDisplay`.

**Step 2: Run test to verify it fails**

Run: `cd apps/electron && bun test src/renderer/components/writing/__tests__/WritingChatDropdown.test.tsx`

Expected: FAIL.

**Step 3: Implement writing shell in `ChatPage`**

Add a branch:

```tsx
const writingProject = React.useMemo(
  () => workingDirectory ? detectWritingProject(workingDirectory) : null,
  [workingDirectory]
);

if (writingProject?.type === "novel" && !isCompactMode) {
  return (
    <NovelWritingSessionPage
      header={...}
      chatDropdown={...}
      workspacePanel={...}
    />
  );
}
```

Keep the existing `ChatDisplay` path intact for normal sessions and compact popovers.

**Step 4: Reuse existing chat behavior**

Prefer embedding `ChatDisplay` in compact mode inside the dropdown first. If `compactMode` hides required controls, add a `presentation="dropdown"` prop rather than duplicating send logic.

**Step 5: Run tests**

Run: `cd apps/electron && bun test src/renderer/components/writing/__tests__/WritingChatDropdown.test.tsx`

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/electron/src/renderer/pages/ChatPage.tsx apps/electron/src/renderer/components/writing apps/electron/src/renderer/components/app-shell
git commit -m "feat: move writing chat into top dropdown"
```

---

### Task 10: Add Semantic Change Summary For Current Turn

**Files:**
- Modify: `apps/electron/src/renderer/lib/writing-workspace.ts`
- Modify: `apps/electron/src/renderer/components/writing/NovelWorkspacePanel.tsx`
- Test: `apps/electron/src/renderer/lib/__tests__/writing-workspace.test.ts`

**Step 1: Add failing tests**

Feed raw `FileChange[]` values similar to `collectFileChangesFromActivities` output and assert semantic groups:
- `bible/characters/alice.md` appears under `Characters`.
- `story/chapters/chapter-02.md` appears under `Manuscript`.
- `timeline/current-chapter.md` appears under `Timeline`.
- Unknown files appear under `Other`.

**Step 2: Run test to verify it fails**

Run: `cd apps/electron && bun test src/renderer/lib/__tests__/writing-workspace.test.ts`

Expected: FAIL for the new assertions.

**Step 3: Connect to turn activities**

Use the existing function:

```ts
import { collectFileChangesFromActivities } from "@/lib/file-changes";
```

In `NovelWorkspacePanel`, accept either:

```ts
currentTurnActivities?: ActivityItem[];
```

or precomputed changes from `ChatPage`. Prefer precomputed data if that avoids importing chat internals into the writing panel.

**Step 4: Render summaries**

In `Changes`, show:
- grouped category
- file name
- operation count
- direct action to open diff via existing multi-diff overlay where possible

Do not present raw terminal/tool output as the primary writing change summary.

**Step 5: Run tests**

Run: `cd apps/electron && bun test src/renderer/lib/__tests__/writing-workspace.test.ts`

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/electron/src/renderer/lib/writing-workspace.ts apps/electron/src/renderer/components/writing/NovelWorkspacePanel.tsx
git commit -m "feat: summarize novel changes by writing section"
```

---

### Task 11: Add Novel Workspace Creation Entry

**Files:**
- Modify: `apps/electron/src/renderer/components/workspace/AddWorkspaceStep_CreateNew.tsx`
- Modify: `apps/electron/src/renderer/components/workspace/WorkspaceCreationScreen.tsx`
- Modify: `apps/electron/src/shared/types.ts`
- Modify: `apps/electron/src/preload/bootstrap.ts`
- Modify: `apps/electron/src/transport/channel-map.ts`
- Modify: workspace creation handler in server/main transport layer
- Test: `apps/electron/src/renderer/components/workspace/__tests__/workspace-create-novel.test.tsx`

**Step 1: Write failing tests**

Assert the create workspace UI offers:
- `General workspace`
- `Novel writing workspace`

When `Novel writing workspace` is selected, the creation request carries `projectType: "novel"`.

**Step 2: Run test to verify it fails**

Run: `cd apps/electron && bun test src/renderer/components/workspace/__tests__/workspace-create-novel.test.tsx`

Expected: FAIL.

**Step 3: Extend creation payload**

Add an optional field:

```ts
projectType?: "general" | "novel";
```

The backend should call `createNovelWorkspaceAtPath` only when `projectType === "novel"`.

**Step 4: Keep the UI restrained**

Use a segmented control or radio group. Do not add a marketing screen. The default should remain `General workspace` unless the user explicitly chooses novel writing.

**Step 5: Run tests**

Run: `cd apps/electron && bun test src/renderer/components/workspace/__tests__/workspace-create-novel.test.tsx`

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/electron/src/renderer/components/workspace apps/electron/src/shared apps/electron/src/preload apps/electron/src/transport
git commit -m "feat: add novel workspace creation option"
```

---

### Task 12: Update i18n

**Files:**
- Modify: `packages/shared/src/i18n/locales/en.json`
- Modify: `packages/shared/src/i18n/locales/zh-Hans.json`
- Modify: `packages/shared/src/i18n/locales/es.json`
- Modify: `packages/shared/src/i18n/locales/ja.json`
- Modify: `packages/shared/src/i18n/locales/hu.json`
- Modify: `packages/shared/src/i18n/locales/de.json`
- Modify: `packages/shared/src/i18n/locales/pl.json`

**Step 1: Add keys**

Add keys under a stable namespace such as:

```json
{
  "writing": {
    "workspace": "Writing workspace",
    "chat": "Writing chat",
    "openChat": "Open writing chat",
    "tabs": {
      "manuscript": "Manuscript",
      "outline": "Outline",
      "characters": "Characters",
      "locations": "Locations",
      "state": "State",
      "timeline": "Timeline",
      "changes": "Changes"
    },
    "emptySection": "No files in this section yet",
    "novelWorkspace": "Novel writing workspace",
    "generalWorkspace": "General workspace"
  }
}
```

For non-English locales, either provide real translations or intentionally mirror English for the first pass. Locale parity must pass.

**Step 2: Run i18n checks**

Run:

```bash
bun run lint:i18n:parity
bun run lint:i18n:sorted
bun run lint:i18n:coverage
```

Expected: PASS. If sorted check fails, run `bun run sort-locales` and re-run checks.

**Step 3: Commit**

```bash
git add packages/shared/src/i18n/locales
git commit -m "feat: add writing workspace translations"
```

---

### Task 13: Full Verification

**Files:**
- No new files unless fixing failures.

**Step 1: Run focused tests**

Run:

```bash
cd packages/shared && bun test src/writing src/prompts/__tests__/system-novel.test.ts src/agent/__tests__/novel-prompt-profile.test.ts
cd apps/electron && bun test src/renderer/lib/__tests__/writing-workspace.test.ts src/renderer/components/writing
```

Expected: PASS.

**Step 2: Run type checks**

Run:

```bash
bun run typecheck:shared
bun run typecheck:electron
```

Expected: PASS.

**Step 3: Run i18n checks**

Run:

```bash
bun run lint:i18n:parity
bun run lint:i18n:sorted
bun run lint:i18n:coverage
```

Expected: PASS.

**Step 4: Run renderer smoke verification**

Run: `bun run electron:dev`

Manual verification:
- Create a novel writing workspace.
- Confirm `craft-writing.json`, `bible/`, `story/`, `state/`, `timeline/`, and seeded skills exist.
- Open a session with that workspace as working directory.
- Confirm the main view is the novel workspace.
- Confirm chat is available from the top dropdown and does not consume the main body when closed.
- Ask the agent to update a character and a chapter file.
- Confirm `Changes` groups edits under `Characters` and `Manuscript`.

**Step 5: Commit fixes if needed**

```bash
git add <fixed-files>
git commit -m "fix: stabilize novel writing workspace"
```

---

## Non-Goals For This Phase

- Do not implement screenplay-specific templates yet. Only keep the manifest and APIs open for `screenplay`.
- Do not port Claude-Book's `.claude/agents` as runtime agents.
- Do not make `perplexity-improver` a required gate. It is GPU-heavy and should be optional later.
- Do not auto-edit `bible/` during chapter generation unless the user explicitly asks.
- Do not replace the existing generic chat UI for normal workspaces.

## Risks And Mitigations

- **Risk:** Novel logic leaks into generic sessions.
  **Mitigation:** Gate behavior on `detectWritingProject(workingDirectory)`.

- **Risk:** Copied Claude-Book content creates license ambiguity.
  **Mitigation:** Rewrite skills for Craft, include `NOTICE-Claude-Book.md`, keep source revision.

- **Risk:** Top dropdown chat hides necessary controls.
  **Mitigation:** Reuse `ChatDisplay` compact behavior first and keep a full-chat fallback action.

- **Risk:** File watching becomes expensive for large manuscripts.
  **Mitigation:** Start with file lists and read-on-open previews; add indexed previews later only if needed.

- **Risk:** Future screenplay support is blocked by naming.
  **Mitigation:** Shared layer uses `writing/*` types and `WritingProjectType`; UI components can be novel-specific until screenplay requirements exist.

## Completion Criteria

- A new workspace can be created as a novel writing workspace.
- A novel workspace has Claude-Book-inspired folders, manifest, notices, and Craft-compatible skills.
- Sessions rooted in a novel workspace use the novel prompt profile.
- The main panel shows the novel workspace, not a full-height chat transcript.
- Chat is available through a compact top dropdown/tab.
- Users can inspect manuscript, outline, characters, locations, state, timeline, and semantic changes.
- Focused tests, type checks, and i18n checks pass.
