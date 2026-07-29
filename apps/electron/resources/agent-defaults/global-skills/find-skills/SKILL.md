---
name: find-skills
description: Helps users discover, review, and install reusable agent skills when they ask for a specialized workflow or want to extend Storyflow.
metadata: { displayName: 查找 Skills }
---

# Find Skills

Use SkillHub as Storyflow's primary public catalog for discovering reusable
Skills. Storyflow uses Pi's native Agent Skills discovery; SkillHub provides
the public catalog, publishing, versions, and sharing.

## When to use

Use this Skill when the user:

- asks whether a reusable Skill exists for a task;
- wants a specialized writing, review, research, or production workflow;
- wants to browse or install Skills;
- repeats a workflow that may be worth packaging as a Skill.

Do not search for a Skill when the task is already simple enough to complete
directly.

## Discovery workflow

### 1. Clarify the actual task

Identify the domain, desired output, and whether the Skill should belong only
to the current project or be available in every Storyflow project.

Writing and content-creation Skills must use project scope so the workflow and
its assumptions stay with the work.

### 2. Search SkillHub

Browse <https://skillhub.cn/> or, when the SkillHub CLI is already installed,
run:

```bash
skillhub search "<query>"
```

Use task-specific Chinese and English keywords when useful. For example:

- `小说 人物设计`
- `剧本 分场`
- `plot causality`
- `prose revision`

### 3. Review before recommending

Do not recommend or install from search results alone. Inspect:

1. the full `SKILL.md` and any scripts or references;
2. the author, source repository, license, version, and update history;
3. requested tools, network access, credentials, and file mutations;
4. whether the workflow preserves the user's source content;
5. whether an existing project Skill already covers the same responsibility.

Present the best one to three candidates with their purpose, source, and
material risks. Ask for explicit confirmation before installing third-party
code.

### 4. Install into Storyflow

Install a writing or project-specific Skill into the current project:

```bash
skillhub install <slug> --dir .agents/skills
skillhub --dir .agents/skills verify <slug>
```

Install a genuinely reusable non-writing user Skill for all Storyflow projects:

```bash
skillhub install <slug> --dir "$HOME/.pi/agent/skills"
skillhub --dir "$HOME/.pi/agent/skills" verify <slug>
```

Storyflow detects both scopes through Pi's native loader. Never install writing
Skills globally or copy them into another global Skill directory.

If `skillhub` is unavailable, open
<https://skillhub.cn/install/skillhub.md>, explain the external installer's
actions and trust boundary, and obtain confirmation before running it. Never
silently pipe a remote installer into a shell.

### 5. Validate the result

After installation:

1. confirm the destination contains `<slug>/SKILL.md`;
2. review any verification warnings;
3. confirm Storyflow shows the expected scope;
4. run one small task that exercises the Skill's core workflow.

## When no suitable Skill exists

Offer to complete the task directly. If the workflow will recur, use the
bundled `skill-creator` to create and validate a project Skill. Do not create a
new Skill merely to wrap a one-off prompt.
