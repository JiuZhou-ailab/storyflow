# Skills Configuration Guide

Storyflow Skills are reusable instructions loaded by every project from one global directory:

```text
~/.craft-agent/skills/<slug>/
├── SKILL.md
├── icon.svg        # optional
└── ...             # optional supporting files
```

Storyflow does not discover Skills from `~/.agents`, `~/.codex`, an arbitrary working directory, or `<project>/.pi/skills`. Existing project-local directories are left untouched but are no longer loaded.

## Create a Skill

Use the Add Skill action and describe the behavior you want. After confirming the summarized draft, Storyflow calls:

```text
skill_create({
  skillSlug: "code-review",
  content: "---\nname: code-review\n..."
})
```

Creation validates the complete `SKILL.md` and never overwrites an existing slug. Then validate it:

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

The same Skills appear in every project's Skills panel and slash menu. Storyflow requires the Agent to read the resolved `SKILL.md` before executing its instructions.
New invocations use the global `[skill:<slug>]` reference. Legacy project-qualified references remain readable but are no longer generated.

If a Skill declares `requiredSources`, Storyflow resolves those Sources in the active project's Source overlay and enables the authenticated matches before the turn begins.

## Editing and Deleting

Use the Skills panel to open `~/.craft-agent/skills/<slug>/SKILL.md`. Editing changes the Skill for every project. Deleting removes only that global slug.

After editing, run `skill_validate` again. The global watcher invalidates the Skills cache, and Pi reloads Skills at the next prompt boundary.

## Troubleshooting

- Not listed: confirm the file is `~/.craft-agent/skills/<slug>/SKILL.md`.
- Validation fails: make `name` match the directory slug and provide a non-empty `description` and body.
- Source unavailable: authenticate the slug in the active project or remove it from `requiredSources`.
- Icon missing: use a supported `icon.*` filename or a valid emoji/URL in frontmatter.
