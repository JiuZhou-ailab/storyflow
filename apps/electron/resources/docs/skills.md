# Skills Configuration Guide

Storyflow uses Pi's native Agent Skills discovery. User Skills are shared;
project Skills stay with their repository:

```text
~/.pi/agent/skills/<slug>/       # Storyflow-created user Skills
~/.agents/skills/<slug>/         # ecosystem user Skills
<project>/.pi/skills/<slug>/     # Pi project Skills
<project>/.agents/skills/<slug>/ # ecosystem project Skills
├── SKILL.md
├── icon.svg        # optional
└── ...             # optional supporting files
```

Pi validates names, follows and deduplicates symlinks, applies project-over-user
precedence, and reports collisions. Storyflow projects that catalog unchanged.

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

User Skills appear in every project. Project Skills appear only when that
project is active. Storyflow requires the Agent to read the resolved `SKILL.md`
before executing its instructions.
Invocations use `[skill:<slug>]`; Pi resolves the winning definition.

If a Skill declares `requiredSources`, Storyflow resolves those Sources in the active project's Source overlay and enables the authenticated matches before the turn begins.

## Editing and Deleting

Use the Skills panel to open the exact resolved file. The scope badge shows
whether the Skill is `user` or `project`. Packaged Skills must be removed with
their package manager.

After editing, run `skill_validate` again. Storyflow refreshes the Skills panel
and Pi reloads Skills at the next prompt boundary.

## Troubleshooting

- Not listed: inspect Pi diagnostics for invalid frontmatter or a name collision.
- Validation fails: make `name` match the directory slug and provide a non-empty `description` and body.
- Source unavailable: authenticate the slug in the active project or remove it from `requiredSources`.
- Icon missing: use a supported `icon.*` filename or a valid emoji/URL in frontmatter.
