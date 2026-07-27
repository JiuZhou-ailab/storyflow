# Storyflow Runtime Contract

Use this adapter only when the host is Storyflow. It keeps writes inside Storyflow's validated global Skill store while leaving the official Skill Creator method intact.

## Resolve the target

Storyflow has one Skill scope:

- Global Skill: `~/.craft-agent/skills/<slug>/`

Do not redirect Storyflow Skills into `.agents`, `.codex`, a project directory, or an arbitrary working directory.

## Create safely

1. Inspect visible Skills first and reject accidental duplicate responsibilities.
2. Confirm the slug, triggers, expected output, and success criteria before writing.
3. Create the complete initial `SKILL.md` with `skill_create`. This boundary validates ownership and refuses silent overwrite.
4. Add justified `scripts/`, `references/`, `assets/`, or `evals/` only inside the returned global Skill directory.
5. Run `skill_validate`. When shell execution is available, also run this creator's `scripts/quick_validate.py` against the finished directory.

For updates, use the active resource-edit flow. Never call `skill_create` over an existing slug and never overwrite user content silently.

## Evaluate in the available runtime

- If independent agents are available, run paired with-Skill and baseline evaluations as described in `SKILL.md`.
- Without independent agents, run the Claude.ai-style inline workflow and disclose that the comparison is not independent.
- Without a browser, generate the review viewer with `--static`.
- Keep evaluation workspaces outside the finished Skill package.

Report the actual path, validation evidence, and any host limitation that prevented the full official loop.
