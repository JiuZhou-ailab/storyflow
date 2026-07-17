# Skills Configuration Guide

Storyflow Skills are project-owned instructions loaded by the Pi runtime. Each project has one canonical Skills directory:

```text
<project>/.pi/skills/<slug>/
├── SKILL.md
├── icon.svg        # optional
└── ...             # optional supporting files
```

Storyflow does not discover Skills from `~/.agents`, `~/.codex`, an arbitrary working directory, or another project. Legacy project-local Skills are copied into `.pi/skills` when the project is migrated; all subsequent reads and writes use the canonical path.

## Create a Skill

Create a lowercase, hyphenated directory under the current project:

```bash
mkdir -p .pi/skills/code-review
```

Add `.pi/skills/code-review/SKILL.md`:

```markdown
---
name: code-review
description: Review code changes for maintainability and project conventions.
metadata:
  displayName: 代码审查
requiredSources:
  - github
---

# Code Review

Review the requested diff. Report concrete findings with file and line references.
```

Then validate it:

```text
skill_validate({ skillSlug: "code-review" })
```

## Frontmatter

- `name` is required and must equal the parent directory slug: lowercase letters, digits, and hyphens, up to 64 characters.
- `description` is required and should state when the Skill applies.
- `metadata.displayName` is an optional human-facing or localized label.
- `requiredSources` optionally lists Source slugs to enable before the Skill runs.
- `globs` and `alwaysAllow` remain available for Storyflow metadata and policy integration.
- `icon` may be an emoji or URL. A local `icon.svg`, `icon.png`, `icon.jpg`, or `icon.jpeg` is also displayed automatically.

The Markdown body contains the instructions Pi should follow. Keep one Skill focused on one capability; put detailed references or scripts beside `SKILL.md` and link to them from the body.

## Invocation

Skills appear in the project Skills panel and slash menu. Selecting `/code-review` inserts a project-qualified Skill mention. Storyflow requires the agent to read that Skill before executing its instructions.

If a Skill declares `requiredSources`, authenticated Sources are enabled for the session before the turn begins. Missing or unauthenticated Sources are skipped and handled by the normal Source activation flow.

## Editing and Deleting

Use the Skills panel to open the current project’s `.pi/skills` folder or `SKILL.md`. Deleting a Skill removes only its canonical directory from the current project; legacy or global directories are never deleted.

After editing, run `skill_validate` again. The project watcher invalidates the Skills cache, and Pi reloads project Skills at the next prompt boundary.

## Troubleshooting

- Not listed: confirm the file is `<project>/.pi/skills/<slug>/SKILL.md`.
- Validation fails: make `name` match the directory slug and provide a non-empty `description` and body.
- Source unavailable: authenticate the slug listed in `requiredSources` or remove it.
- Icon missing: use a supported `icon.*` filename or a valid emoji/URL in frontmatter.
