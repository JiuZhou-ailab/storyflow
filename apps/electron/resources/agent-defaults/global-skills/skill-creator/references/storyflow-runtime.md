# Storyflow Runtime Contract

Use this adapter only when the host is Storyflow. It keeps user-level writes inside Pi's validated Skill store while leaving the official Skill Creator method intact.

## Resolve the target

Storyflow's `skill_create` tool creates one user-level scope:

- User Skill: `~/.pi/agent/skills/<slug>/`

Pi also discovers project `.pi/skills` and `.agents/skills`. Use the Skills CLI
when the user explicitly requests a project-local installation.

## Create safely

1. Inspect visible Skills first and reject accidental duplicate responsibilities.
2. Confirm the slug, triggers, expected output, and success criteria before writing.
3. Create the complete initial `SKILL.md` with `skill_create`. This boundary validates ownership and refuses silent overwrite.
4. Add justified `scripts/`, `references/`, `assets/`, or `evals/` only inside the returned user Skill directory.
5. Run `skill_validate`. When shell execution is available, also run this creator's `scripts/quick_validate.py` against the finished directory.

For updates, use the active resource-edit flow. Never call `skill_create` over an existing slug and never overwrite user content silently.

## Evaluate in the available runtime

- Use Pi's read-only `subagent` for independent runs that need files or tools.
- Use Pi's `call_llm` only for tool-free critique or structured comparison; it cannot execute or observe a Skill.
- Without independent agents, run the inline workflow and disclose that the comparison is not independent.
- Without a browser, generate the review viewer with `--static`.
- Keep evaluation workspaces outside the finished Skill package.
- Do not invoke an external agent CLI or create another runtime's command files.

Report the actual path, validation evidence, and any host limitation that prevented the full official loop.
