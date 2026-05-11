# Lightweight Method Pack Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the smallest useful Method Pack system so a new Claude-Book novel project installs one coherent project-level creative environment: structure, skills, instructions, manifest, lock, and validation.

**Architecture:** Treat a Method Pack as the single source of truth for project setup. Start with one built-in pack, `novel.claude-book`, backed by the existing novel scaffold and skills. Avoid a generalized template marketplace, migrations, remote packs, add-on packs, or global artifact ontology in this phase.

**Tech Stack:** TypeScript, shared workspace storage, Electron workspace creation flow, Bun tests.

---

## Scope

Build only this:

- One built-in method pack: `novel.claude-book`.
- A lightweight manifest extension in `craft-writing.json`.
- A lightweight lock file: `craft-pack-lock.json`.
- A scaffold path that creates the current Claude-Book-compatible novel structure.
- Required `state/current/` files, because current scaffold misses them.
- Pack validation for required paths and required skills.
- Backward compatibility: existing `projectType: "novel"` creates `novel.claude-book`.

Do not build this yet:

- Six-pack registry.
- Remote/custom pack import.
- Pack migrations.
- Pack marketplace UI.
- Complex path alias engine.
- Multiple active packs per project.
- General artifact ontology.
- New sidebar architecture.

## Core Concept

The pack is a project-level agent environment installer.

```text
Method Pack
-> scaffold folders/files
-> install skills
-> write AGENTS.md / CLAUDE.md
-> write craft-writing.json
-> write craft-pack-lock.json
-> validate required paths and skills
```

`AGENTS.md`, `CLAUDE.md`, `skills/`, and the folder structure are outputs of the pack, not the source of truth.

## Minimal Data Model

```ts
export interface MethodPack {
  id: "novel.claude-book";
  version: 1;
  projectType: "novel";
  storageProfile: "claude-book-compatible";
  requiredPaths: Array<{ path: string; kind: "file" | "directory" }>;
  requiredSkills: string[];
  runtimePreamble: string;
}
```

Manifest extension:

```json
{
  "schemaVersion": 1,
  "type": "novel",
  "title": "My Novel",
  "profile": "novel",
  "methodPack": {
    "id": "novel.claude-book",
    "version": 1
  },
  "storageProfile": "claude-book-compatible"
}
```

Lock file:

```json
{
  "methodPack": {
    "id": "novel.claude-book",
    "version": 1
  },
  "installedSkills": [
    "book-analyzer",
    "bible-merger",
    "story-ideator",
    "chapter-workflow",
    "style-reviewer",
    "character-reviewer",
    "continuity-reviewer",
    "state-updater"
  ],
  "installedPaths": [
    "bible/style.md",
    "story/chapters",
    "state/current/situation.md",
    "timeline/history.md"
  ]
}
```

## Task 1: Add Method Pack Types And Built-In Pack

**Files:**
- Create: `packages/shared/src/writing/method-packs/types.ts`
- Create: `packages/shared/src/writing/method-packs/claude-book.ts`
- Create: `packages/shared/src/writing/method-packs/index.ts`
- Modify: `packages/shared/src/writing/index.ts`
- Modify: `packages/shared/package.json`
- Test: `packages/shared/src/writing/method-packs/__tests__/claude-book.test.ts`

**Step 1: Write the failing test**

Test:

- `getBuiltInMethodPack("novel.claude-book")` returns the pack.
- pack version is `1`.
- pack project type is `novel`.
- pack required paths include `state/current/situation.md`.
- pack required skills include `chapter-workflow` and `state-updater`.

**Step 2: Run the test to verify it fails**

Run:

```bash
cd packages/shared && bun test src/writing/method-packs/__tests__/claude-book.test.ts
```

Expected: FAIL because the module does not exist.

**Step 3: Implement the minimal code**

Add only one pack:

```ts
export const CLAUDE_BOOK_METHOD_PACK: MethodPack = {
  id: "novel.claude-book",
  version: 1,
  projectType: "novel",
  storageProfile: "claude-book-compatible",
  requiredPaths: [
    { path: "craft-writing.json", kind: "file" },
    { path: "bible/style.md", kind: "file" },
    { path: "bible/structure.md", kind: "file" },
    { path: "bible/characters", kind: "directory" },
    { path: "bible/universe", kind: "directory" },
    { path: "story/synopsis.md", kind: "file" },
    { path: "story/plan.md", kind: "file" },
    { path: "story/chapters", kind: "directory" },
    { path: "state/current/situation.md", kind: "file" },
    { path: "state/current/characters.md", kind: "file" },
    { path: "state/current/knowledge.md", kind: "file" },
    { path: "state/template/situation.md", kind: "file" },
    { path: "state/template/characters.md", kind: "file" },
    { path: "state/template/knowledge.md", kind: "file" },
    { path: "timeline/history.md", kind: "file" },
    { path: "timeline/current-chapter.md", kind: "file" },
    { path: "analysis/src", kind: "directory" },
    { path: "analysis/output", kind: "directory" },
    { path: ".work", kind: "directory" },
  ],
  requiredSkills: [
    "book-analyzer",
    "bible-merger",
    "story-ideator",
    "chapter-workflow",
    "style-reviewer",
    "character-reviewer",
    "continuity-reviewer",
    "state-updater",
  ],
  runtimePreamble: "This project uses the novel.claude-book method pack. Use bible/ as canon, story/chapters/ as manuscript, state/current/ as current continuity state, timeline/ as chronology, and .work/ for drafts and reports.",
};
```

Add:

```ts
export function getBuiltInMethodPack(id: string): MethodPack | null;
```

**Step 4: Export the module**

Add exports from `packages/shared/src/writing/index.ts` and `packages/shared/package.json`.

**Step 5: Run the test**

Run:

```bash
cd packages/shared && bun test src/writing/method-packs/__tests__/claude-book.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/shared/src/writing/method-packs packages/shared/src/writing/index.ts packages/shared/package.json
git commit -m "feat: add claude book method pack"
```

## Task 2: Install Method Pack During Novel Scaffold

**Files:**
- Modify: `packages/shared/src/writing/types.ts`
- Modify: `packages/shared/src/writing/novel-template.ts`
- Test: `packages/shared/src/writing/__tests__/novel-template.test.ts`

**Step 1: Write the failing tests**

Extend existing scaffold tests:

- `craft-writing.json` includes `methodPack.id = "novel.claude-book"`.
- `craft-writing.json` includes `storageProfile = "claude-book-compatible"`.
- `craft-pack-lock.json` exists.
- `state/current/situation.md`, `state/current/characters.md`, and `state/current/knowledge.md` exist.
- `AGENTS.md` and `CLAUDE.md` exist.

**Step 2: Run the test to verify it fails**

Run:

```bash
cd packages/shared && bun test src/writing/__tests__/novel-template.test.ts
```

Expected: FAIL because these files/fields are not created yet.

**Step 3: Implement minimal scaffold changes**

Update `WritingProjectManifest`:

```ts
methodPack?: {
  id: string;
  version: number;
};
storageProfile?: string;
```

Update `createNovelProjectScaffold`:

- add `state/current` directory.
- write `state/current/situation.md`.
- write `state/current/characters.md`.
- write `state/current/knowledge.md`.
- write `AGENTS.md`.
- write `CLAUDE.md`.
- write `craft-pack-lock.json`.
- preserve existing files.

**Step 4: Run the test**

Run:

```bash
cd packages/shared && bun test src/writing/__tests__/novel-template.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/writing/types.ts packages/shared/src/writing/novel-template.ts packages/shared/src/writing/__tests__/novel-template.test.ts
git commit -m "feat: install claude book method pack scaffold"
```

## Task 3: Validate And Repair The Installed Pack

**Files:**
- Create: `packages/shared/src/writing/method-packs/validation.ts`
- Test: `packages/shared/src/writing/method-packs/__tests__/validation.test.ts`

**Step 1: Write the failing tests**

Cover:

- freshly scaffolded project has no validation findings.
- deleting `state/current/situation.md` produces a missing path finding.
- deleting `skills/chapter-workflow/SKILL.md` produces a missing skill finding.
- repair recreates missing files without overwriting existing user content.

**Step 2: Run the test to verify it fails**

Run:

```bash
cd packages/shared && bun test src/writing/method-packs/__tests__/validation.test.ts
```

Expected: FAIL.

**Step 3: Implement minimal validation**

Add:

```ts
export interface MethodPackValidationFinding {
  severity: "error" | "warning";
  code: "missing_path" | "missing_skill";
  path: string;
}

export function validateMethodPackInstall(rootPath: string, pack: MethodPack): MethodPackValidationFinding[];
export function repairMethodPackInstall(rootPath: string, pack: MethodPack): MethodPackValidationFinding[];
```

Implementation rule:

- validation only checks required paths and required skill files.
- repair calls the same safe scaffold writer used by `createNovelProjectScaffold`.
- no migrations.
- no content rewriting.

**Step 4: Run the test**

Run:

```bash
cd packages/shared && bun test src/writing/method-packs/__tests__/validation.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/writing/method-packs/validation.ts packages/shared/src/writing/method-packs/__tests__/validation.test.ts
git commit -m "feat: validate claude book method pack installs"
```

## Task 4: Keep Workspace Creation API Lightweight

**Files:**
- Modify: `packages/server-core/src/handlers/rpc/workspace-creation.ts`
- Modify: `apps/electron/src/shared/types.ts`
- Test: `packages/server-core/src/handlers/rpc/workspace-creation.test.ts`

**Step 1: Write the failing tests**

Cover:

- legacy `projectType: "novel"` still creates a novel workspace.
- optional `methodPackId: "novel.claude-book"` creates a novel workspace.
- unknown `methodPackId` throws or falls back to general based on current handler error style.

**Step 2: Run the test**

Run:

```bash
bun test packages/server-core/src/handlers/rpc/workspace-creation.test.ts
```

Expected: FAIL until `methodPackId` is supported.

**Step 3: Implement minimal API change**

Add:

```ts
export type WorkspaceMethodPackId = "novel.claude-book";

export interface CreateWorkspaceOptions {
  remoteServer?: CoreRemoteServerConfig;
  projectType?: WorkspaceProjectType;
  methodPackId?: WorkspaceMethodPackId;
}
```

Normalize:

```ts
projectType === "novel" -> methodPackId = "novel.claude-book"
```

Keep UI unchanged for now. The existing "Novel writing workspace" option still maps to this pack.

**Step 4: Run the test**

Run:

```bash
bun test packages/server-core/src/handlers/rpc/workspace-creation.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/server-core/src/handlers/rpc/workspace-creation.ts apps/electron/src/shared/types.ts packages/server-core/src/handlers/rpc/workspace-creation.test.ts
git commit -m "feat: accept workspace method pack id"
```

## Task 5: Add Runtime Preamble Helper Only

**Files:**
- Create: `packages/shared/src/writing/method-packs/runtime.ts`
- Test: `packages/shared/src/writing/method-packs/__tests__/runtime.test.ts`

**Step 1: Write the failing test**

Assert:

- `buildMethodPackRuntimePreamble(CLAUDE_BOOK_METHOD_PACK)` includes `novel.claude-book`.
- it includes `bible/`, `story/chapters/`, `state/current/`, `timeline/`, and `.work/`.

**Step 2: Run the test**

Run:

```bash
cd packages/shared && bun test src/writing/method-packs/__tests__/runtime.test.ts
```

Expected: FAIL.

**Step 3: Implement helper**

Add:

```ts
export function buildMethodPackRuntimePreamble(pack: MethodPack): string {
  return pack.runtimePreamble;
}
```

Do not wire it into agent prompt assembly yet. Keep this phase small.

**Step 4: Run the test**

Run:

```bash
cd packages/shared && bun test src/writing/method-packs/__tests__/runtime.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/writing/method-packs/runtime.ts packages/shared/src/writing/method-packs/__tests__/runtime.test.ts
git commit -m "feat: add method pack runtime preamble helper"
```

## Task 6: Verification

**Files:**
- No new files unless failures require fixes.

**Step 1: Run shared writing tests**

Run:

```bash
cd packages/shared && bun test src/writing
```

Expected: PASS.

**Step 2: Run workspace creation tests**

Run:

```bash
bun test packages/server-core/src/handlers/rpc/workspace-creation.test.ts packages/shared/src/workspaces/__tests__/storage-novel-template.test.ts
```

Expected: PASS.

**Step 3: Manual smoke check**

Create a new novel workspace from the current UI.

Confirm:

```text
craft-writing.json
craft-pack-lock.json
AGENTS.md
CLAUDE.md
bible/
story/
state/current/
timeline/
analysis/
.work/
skills/chapter-workflow/SKILL.md
skills/state-updater/SKILL.md
```

**Step 4: Commit final verification fixes**

```bash
git status --short
git add <changed-files>
git commit -m "test: verify lightweight method pack"
```

