# Runtime Domain Separation Implementation Plan

**Goal:** Add application-level Free Conversations that are isolated from projects while reusing the existing Agent, session persistence, and resource modules.

**Architecture:** Keep one Agent Kernel, SessionManager, Resource Resolver, and Workspace identity model. A runtime `workspaceId` resolves directly to the existing `Workspace` DTO. Free Conversations use one hidden application-owned Workspace and a private per-session working directory; Project Conversations keep their existing workspace. Global resource and model-connection definitions come from `~/.craft-agent`, with an optional project Skills/Sources overlay.

## Decision on the current plan

Do not continue the current UI-only direction as a shippable change. The new Activity Rail item may be retained as presentation work, but its route must not point at the current project's `allSessions`. Backend ownership and workspace isolation must exist before the entry is enabled.

## Implementation status

| Phase | Status | Evidence |
|---|---|---|
| 1. Runtime workspace contract | Implemented | One `workspaceId → Workspace` resolver |
| 2. Application workspace | Implemented | Hidden Workspace, private session `work/`, file-tool boundary, Bash disabled |
| 3. Resource resolution | Implemented | Shared root resolver; global-only and project-overlay tests |
| 4. Navigation | Implemented | One workspace activation path; Free history is independent of project history |
| 5. Domain transfer | Implemented as summary-only MVP | Fresh target session seeded by an immutable generated summary |
| 6. End-to-end QA | Automated gates passed; desktop runbook pending | Full repository tests, typecheck, IPC/i18n checks, and Electron dev build pass; interactive Electron flow still requires execution |

## Non-goals

- No second Agent runtime, SessionManager, database, or resource loader.
- No runtime synchronization with `~/.agents`, `~/.codex`, or `~/.pi`.
- No project-directory picker inside Free Conversations.
- No migration of existing project messages or project files.
- No executable project Extensions.

## Phase 1: Use Workspace as the room identity

- Use one `workspaceId` contract for both the hidden application workspace and project workspaces.
- Resolve the id directly to `Workspace`; do not duplicate it as owner, runtime context, navigation key, or JSONL state.
- Keep workspace selection outside Agent backends; backends receive the already-resolved workspace boundary.
- Treat existing sessions discovered under a project workspace as project-owned without rewriting their messages.

Acceptance:

- The same SessionManager creates and loads both workspace variants.
- Existing project conversations open without content migration.
- No Agent backend contains a free-versus-project branch.

## Phase 2: Add the application-owned workspace context

- Resolve the Free Conversation Domain to one hidden storage context under the Craft application data root.
- Give each Free Conversation a private working directory inside its own session boundary.
- Ensure prompt context, file-tree injection, shell cwd, file tools, attachments, generated data, plans, and downloads use that private boundary.
- Keep the hidden context out of project discovery and project switching.

Acceptance:

- A Free Conversation can be created before any project is opened.
- Switching or closing projects does not change its history or workspace.
- Its Agent cannot enumerate or read a project unless individual files were explicitly attached.

## Phase 3: Unify resource resolution

- Resolve resource roots once from `{ projectRoot?, globalRoot? }` and feed the result into the existing
  Skills, Sources, and Pi extension loaders.
- Always resolve global Skills, Sources, and trusted Extensions from `~/.craft-agent`.
- When `projectRoot` exists, apply that project's Skills and Sources as an overlay.
- Keep Extension definitions global and instantiate them within the resolved Workspace boundary.
- Keep model connections in the existing global configuration and store only the selected connection reference on a session.
- Remove runtime dependence on external user resource directories; support only explicit one-time import when needed.

Acceptance:

- Free Conversations see global resources only.
- Project Conversations see the same global resources plus their own project overlay.
- No resource is copied during normal resolution, and changing projects cannot mutate the global root.

## Phase 4: Correct the navigation contract

- Route the Activity Rail “自由对话” entry to application-owned conversation history.
- Keep project conversation history inside the corresponding project surface.
- Query sessions by the active workspace id, not by whichever project was previously selected.
- Preserve the existing visual work only where it matches this ownership contract.

Acceptance:

- Opening “自由对话” shows the same history regardless of the selected project.
- Project `allSessions` never appears as Free Conversation history.
- Project conversations remain reachable only from their owning project.

## Phase 5: Add explicit domain transfer

- Generate one immutable summary from the source conversation.
- Create a new seeded session under the target workspace from that summary.
- Apply the target workspace's own permission, status, label, model, and resource defaults.
- Do not use provider-native SDK fork across workspaces.
- Do not copy provider transcripts, SessionBundle files, project files, or attachments.
- Keep source and target histories independent after creation.

Acceptance:

- Transfer never changes the source workspace, history, or files.
- The target receives only the generated summary snapshot.
- Source-domain operational state is not inherited by the target session.
- Later edits and messages do not synchronize between the two sessions.

Message-level selection and attachment copying are intentionally deferred. They add selection UI, file lifecycle,
permission, and sanitization contracts without improving the ownership boundary. If a concrete product need appears,
extend the snapshot payload explicitly rather than reusing whole-session export/import.

## Phase 6: End-to-end QA

Run the desktop flow from a clean application state:

1. Start Storyflow without opening a project and enter the hidden Free Conversation workspace.
2. Create a file, attach an external file, and verify directory access remains bounded.
3. Open two different projects and verify the Free Conversation history remains unchanged.
4. Create one conversation in each project and verify each project sees only its own history.
5. Verify global Skills/Sources are present in all domains and project Skills appear only in their project.
6. Transfer a summary snapshot from Free Conversation to a project and verify both histories diverge independently.
7. Restart Storyflow and repeat the ownership, workspace, and resource checks.

Automated verification covers ownership resolution, resource overlays, hard file-tool boundaries, immutable Free
Conversation cwd, renderer routing, and summary-only transfer orchestration. The full repository test stages,
typecheck, IPC/i18n checks, and an Electron development build pass. A production build correctly rejects the local
localhost auth broker and was not used to bypass the release configuration contract. Release readiness still
requires this interactive desktop runbook; renderer routing tests alone are insufficient.
