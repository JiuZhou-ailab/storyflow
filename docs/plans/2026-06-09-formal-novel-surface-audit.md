<!--
input: README product claims, method-pack registry/types, writing scaffold tests, and read-only semantic surface search.
output: Formal novel release-surface audit with minimal cleanup recommendations.
pos: Wave 1 product-surface boundary document; separates active formal-novel release claims from broader workbench infrastructure.
-->

# Formal Novel Product Surface Audit

Date: 2026-06-09
Owner: Wave 1 Agent E
Scope: audit only. This document does not delete method packs, provider modes, AppShell behavior, session persistence, browser manager behavior, ChatDisplay behavior, or provider routing.

## Evidence Used

- `README.md`
  - Positions Storyflow as an "AI Agent 工作台" with Electron, headless server, external sources, skills, file editing, diff review, automation, and writing workflows.
  - Lists `webui`, `viewer`, `marketing`, `messaging-gateway`, and messaging workers as top-level repo packages.
  - Describes built-in writing method packs as Claude-Book, Oh Story, Crucible, and generic creative writing, while the current registry exports a different active built-in set.
- `packages/shared/src/writing/method-packs/index.ts`
  - Current built-in registry exports `short-form.article`, `novel.claude-book`, `screenplay.logic`, and `novel.free-creation`.
  - Keeps `WorkspaceProfile` as a transitional alias over Method Packs.
- `packages/shared/src/writing/method-packs/types.ts`
  - The type union still includes deferred/non-registry ids: `novel.oh-story`, `novel.crucible`, and `novel.creative-writing`.
  - Project types are `novel`, `screenplay`, and `short-form`.
- `packages/shared/src/writing/__tests__/novel-template.test.ts`
  - Protects the formal novel default scaffold as `novel.claude-book`.
  - Also protects selected non-formal surfaces: `screenplay.logic`, `novel.free-creation`, and `short-form.article`.
- `packages/shared/src/writing/__tests__/novel-skills.test.ts`
  - Protects bundled Claude-Book-derived novel skills.
  - Also protects short-form and screenplay skill seeding/routing.
- Read-only semantic search found likely user-facing surface files in Electron writing UI, writing workspace classification, novel skills, marketing, webui/viewer, feedback worker, and messaging gateway. Those files were not modified in this audit.

## Release Surface Classification

| Surface | Classification | Current evidence | Boundary decision |
| --- | --- | --- | --- |
| Electron desktop host | Active release surface | README calls Electron the core product and release artifacts are desktop installers. | Keep as the shipping shell, but product copy should make formal novel writing the primary user promise, not a generic AI workbench. |
| Chat sessions inside Electron | Active supporting surface | README includes chat sessions and local workspaces as core desktop functions. | Keep as support for formal novel workflows. Do not market generic chat as the primary release surface. |
| Writing workspace | Active release surface | README lists manuscript editing, file mentions, selection rewrite, inline diff review, export controls, and local snapshots. | This is the main formal novel surface. The active release claim should center on long-form novel workspaces. |
| Claude-Book formal novel scaffold | Active release surface | Tests assert `craft-writing.json`, `craft-pack-lock.json`, `AGENTS.md`, Claude-Book notice, `bible/`, `story/`, `state/`, and `timeline/`. | Treat `novel.claude-book` as the only formal-novel release profile. |
| Bundled Claude-Book-derived novel skills | Active release surface | Tests protect 8 bundled novel skills and their scaffold installation. | Keep as formal novel skills; avoid broad "skills marketplace" messaging in release copy. |
| Method pack registry | Mixed | Registry built-ins are `short-form.article`, `novel.claude-book`, `screenplay.logic`, and `novel.free-creation`. Types still name extra ids. | Do not delete IDs or packs. Split display/category metadata before changing user-facing selectors. |
| `screenplay.logic` | Experimental/internal for formal-novel release | Tests protect scaffold, manifest, and skill routing. | Keep runnable, but do not present as part of formal novel release unless the release explicitly expands to screenplay. |
| `short-form.article` | Experimental/internal for formal-novel release | Tests protect short-form scaffold and short-form runtime skills. | Keep runnable, but classify as adjacent writing profile, not formal novel release core. |
| `novel.free-creation` | Experimental/internal for formal-novel release | Tests protect lightweight free creation scaffold. | Keep as a low-structure writing profile; do not conflate with formal novel workflow. |
| `novel.oh-story`, `novel.crucible`, `novel.creative-writing` type ids | Legacy/deferred public surface risk | Present in `MethodPackId`, not current built-in registry. README still names Oh Story, Crucible, and generic creative writing as built-in. | Treat as deferred aliases/contract placeholders unless the concrete pack files are deliberately restored to the registry. Do not remove without migration. |
| Sources | Experimental/internal for formal-novel release | README presents Sources as MCP/REST/local/service integrations. | Keep as workbench infrastructure. Formal novel copy should mention them only as optional context connectors. |
| Skills system | Mixed | Formal novel bundled skills are active; global/workspace/project skill system is broader. | Release surface should distinguish bundled novel skills from the generic skill substrate. |
| Automations | Legacy/deferred for formal-novel release | README presents label/schedule/tool/lifecycle automations. No formal-novel test evidence in the allowed read set. | Do not claim automations as a formal novel release feature until there is a named workflow and QA path. |
| Viewer | Experimental/internal | README lists viewer as shared session record viewer and common dev command. | Keep as developer/support surface, not formal novel product surface. |
| Web UI | Experimental/internal | README lists webui as headless browser client and common dev command. | Keep as headless-server companion, not formal novel release surface. |
| Marketing site | Active distribution surface, not product capability | README says `apps/marketing` is official site/download entry. | Marketing can ship installers and formal-novel positioning; it should not broaden the product promise beyond the release target. |
| Messaging gateway and WhatsApp worker | Legacy/deferred for formal-novel release | README lists packages as repo structure, not formal-novel workflow evidence. | Keep out of formal novel release claims unless a messaging-to-novel workflow is productized and tested. |
| Feedback worker | Active support surface | README lists user feedback entry for screenshots and GitHub issues. | Keep as support/ops, not a creative capability. |
| Provider modes and routing | Active infrastructure, not cleanup target | README lists Claude backend and Pi backend. User explicitly forbids provider-routing changes. | Do not narrow or remove provider modes in this wave. Formal-novel positioning should describe provider modes as runtime connectivity, not product scope. |

## Broad-Surface Labels That Conflict With Formal Novel Target

1. `README.md` opening position: "AI Agent 工作台" makes the release sound like a general-purpose agent workbench rather than a formal novel writing desktop.
2. `README.md` feature list: "来源、技能和自动化", "多 Agent 后端", and "写作方法包" are presented at the same level as the novel writing workspace. This flattens infrastructure, provider connectivity, and product workflow into one product promise.
3. `README.md` method-pack line: it names Claude-Book, Oh Story, Crucible, and generic creative writing as built-in, but the current registry built-ins are `short-form.article`, `novel.claude-book`, `screenplay.logic`, and `novel.free-creation`. This is the clearest stale public-label risk.
4. `README.md` repo tree and dev-command table: `webui`, `viewer`, `marketing`, and messaging packages appear as equal product surfaces. For a formal-novel release they should be marked as distribution, developer, or deferred infrastructure.
5. `README.md` LLM Provider section: the provider list is correct as infrastructure, but in product-level docs it reads as breadth of supported agent products. It should be scoped as runtime connectivity.
6. `docs/plans/2026-05-11-creative-project-template-system.md`: historical plan language describes a broad template-driven creative project system. Keep as historical design context; do not treat it as current release surface.
7. `docs/plans/2026-05-20-method-pack-layout-adaptation.md`: useful method-pack boundary document, but it discusses multiple method packs. It should be linked as method-pack architecture, not as formal-novel release scope.
8. `packages/shared/src/writing/method-packs/types.ts`: deferred ids in the public union can be mistaken for active user choices. This is acceptable only if UI/docs distinguish registered built-ins from reserved/deferred ids.

## Minimal Follow-Up Cleanup

### 1. README Release Positioning

Files:

- `README.md`

Change:

- Rewrite the first paragraph from general "AI Agent 工作台" to "formal novel writing desktop built on a broader agent-workbench substrate".
- Split "项目能力" into:
  - active formal-novel release surface
  - supporting runtime/distribution infrastructure
  - experimental/deferred workbench capabilities
- Fix the method-pack sentence to match the registry:
  - active release: `novel.claude-book`
  - adjacent/experimental built-ins: `screenplay.logic`, `short-form.article`, `novel.free-creation`
  - deferred/reserved typed ids: `novel.oh-story`, `novel.crucible`, `novel.creative-writing`

Tests/validation:

- `git diff --check`
- No unit test is required for README-only wording, unless a docs lint gate is later added.

### 2. Plans Index Hygiene

Files:

- `docs/plans/README.md`
- `docs/plans/2026-06-09-formal-novel-surface-audit.md`

Change:

- Add this audit to the plan index.
- Mark broad creative-template/method-pack plans as historical architecture context, not current formal-novel release surface.

Tests/validation:

- `git diff --check`

Note:

- This audit did not update `docs/plans/README.md` because the authorized write domain for this wave only allowed creating the audit file.

### 3. Method-Pack Public Metadata Guard

Files:

- `packages/shared/src/writing/method-packs/types.ts`
- `packages/shared/src/writing/method-packs/index.ts`
- If UI consumption needs classification: the UI selector/navigator file that reads built-in packs.

Change:

- Do not remove `MethodPackId` members.
- Add an explicit classification boundary only if a user-facing selector or README needs it, for example:
  - `releaseSurface: "formal-novel" | "adjacent-writing" | "deferred"`
  - or a registry-level helper that returns only formal-novel release profiles.
- Keep `WorkspaceProfile` as a transitional alias until manifest/package-path migration exists.

Tests/validation:

- `bun test packages/shared/src/writing/method-packs/__tests__/validation.test.ts`
- `bun test packages/shared/src/writing/method-packs/__tests__/runtime.test.ts`
- `bun test packages/shared/src/writing/__tests__/novel-template.test.ts`
- `bun x tsc --noEmit --pretty false --project packages/shared/tsconfig.json`

### 4. Writing Workspace UI Label Audit

Files to audit before editing:

- `apps/electron/src/renderer/components/writing/NovelWorkspaceNavigatorPanel.tsx`
- `apps/electron/src/renderer/lib/writing-workspace.ts`
- `apps/electron/src/renderer/components/writing/novel-file-display.ts`
- The workspace creation selector files that present project/profile choices.

Change:

- Keep "Novel writing workspace" as the formal-novel path.
- If non-formal packs are visible, label them as experimental/adjacent instead of peer release options.
- Avoid renaming persisted ids, paths, or provider modes.

Tests/validation:

- Existing Electron writing UI tests for workspace creation and navigator behavior.
- `bun test packages/shared/src/writing/__tests__/novel-template.test.ts`
- `bun x tsc --noEmit --pretty false --project packages/shared/tsconfig.json`

### 5. Sources, Skills, Automations, Viewer/WebUI/Marketing/Messaging Copy

Files to audit before editing:

- `README.md`
- `apps/marketing/src/App.tsx`
- `apps/marketing/src/downloads.ts`
- `apps/viewer/*`
- `apps/webui/*`
- `packages/messaging-gateway/*`
- `packages/messaging-whatsapp-worker/*`
- `packages/shared/src/writing/novel-skills.ts`

Change:

- Keep bundled formal-novel skills as active release features.
- Describe generic sources/skills/automations as infrastructure and extension points.
- Keep marketing as the download/positioning surface; ensure landing copy points to formal novel writing rather than generic automation/workbench breadth.
- Keep viewer/webui/messaging as internal, developer, or deferred unless a formal-novel workflow and QA runbook exist.

Tests/validation:

- `bun test packages/shared/src/writing/__tests__/novel-skills.test.ts`
- Marketing route/download tests if the marketing copy is edited.
- `git diff --check`

## What Not To Do In This Wave

- Do not delete `MethodPackId` members just because they are not active release surface.
- Do not delete `screenplay.logic`, `short-form.article`, or `novel.free-creation`; tests currently protect those surfaces.
- Do not change provider routing, managed/custom provider behavior, or provider mode names.
- Do not collapse sources, skills, automations, viewer, webui, or messaging packages into the formal-novel model. They are orthogonal infrastructure/deferred surfaces.
- Do not use README wording as proof that a surface is release-ready. README is currently broader than the active formal-novel target.

## Current Residual Risk

- The README still publicly overstates the active release breadth until a separate authorized cleanup edits it.
- `docs/plans/README.md` does not list this audit yet because this wave only authorized creating the audit file.
- Deferred method-pack ids remain in the public type union. That is safer than deletion, but future UI work needs an explicit active/deferred distinction to avoid accidental surfacing.
- Semantic search identified likely surface files outside this wave's write domain. Those paths should be read and tested before any UI/marketing cleanup.
- Provider and method-pack orthogonality is preserved, but product copy still needs a coordinator pass so later Agents do not accidentally turn formal-novel simplification into provider or pack deletion.

## Validation Runbook

Required for this audit-only change:

```bash
git diff --check
```

Additional commands only if future cleanup edits code or docs beyond this audit:

```bash
bun test packages/shared/src/writing/__tests__/novel-template.test.ts
bun x tsc --noEmit --pretty false --project packages/shared/tsconfig.json
```
