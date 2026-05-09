// input: Built-in novel writing skill definitions
// output: File payloads seeded into novel workspaces
// pos: Packaged skill bundle for the novel writing project profile

import { getClaudeBookNotice } from "./claude-book-notice.ts";

export interface BundledNovelSkillFile {
  relativePath: string;
  content: string;
}

const ATTRIBUTION = "Adapted for Craft Agent from Claude-Book concepts. Source: https://github.com/ThomasHoussin/Claude-Book";

const SKILLS: Array<{ slug: string; content: string }> = [
  {
    slug: "book-analyzer",
    content: `---
name: book-analyzer
description: Use when analyzing a novel, story, or narrative source text to extract a reusable writing bible.
---

# Book Analyzer

${ATTRIBUTION}

## Purpose

Extract evidence-backed writing bible files from source texts so a new project can study style, structure, characters, and locations without lossy summaries.

## Inputs

- Source text files under \`analysis/src/\`
- Existing templates under \`bible/\` when present

## Workflow

1. Read the complete source text before extracting rules.
2. Create \`analysis/output/<source-slug>/style.md\` with point of view, tense, dialogue style, sentence rhythm, vocabulary, and description patterns.
3. Create \`analysis/output/<source-slug>/structure.md\` with act structure, chapter pattern, openings, endings, pacing, and genre mechanics.
4. Create one file per major character under \`analysis/output/<source-slug>/characters/\`.
5. Create one file per significant location or world element under \`analysis/output/<source-slug>/universe/\`.
6. Support every trait, pattern, and rule with direct evidence or a measurable observation.

## Evidence Rules

- Prefer quoted examples with chapter or section references.
- Distinguish observed facts from interpretation.
- Do not invent character traits or world facts to fill template gaps.
- Keep extracted source wording intact when quoting.

## Output Language

Use the project's manifest language for user-facing content. Use English for metadata if no project language is defined.
`,
  },
  {
    slug: "bible-merger",
    content: `---
name: bible-merger
description: Use when merging multiple narrative analyses into one canonical project bible.
---

# Bible Merger

${ATTRIBUTION}

## Purpose

Consolidate multiple \`analysis/output/*/\` analyses into the canonical \`bible/\` directory while preserving source evidence and conflict notes.

## Workflow

1. Inventory all analysis directories included in the merge.
2. Merge \`style.md\` by keeping stable patterns, recording ranges for variable metrics, and flagging source-specific vocabulary.
3. Merge character files by preserving traits demonstrated across sources and marking single-source traits with provenance.
4. Merge universe files by consolidating recurring locations and keeping contradictions explicit.
5. Merge \`structure.md\` into durable narrative rules and non-binding observations.
6. Write \`analysis/merge-report.md\` with sources, consistency analysis, coverage, and conflict resolution.

## Conflict Rules

- Prefer direct evidence over interpretation.
- Prefer later canon only when the project explicitly follows source chronology.
- Document unresolved contradictions instead of hiding them.
- Do not overwrite existing bible files without preserving their prior content in the merge report.
`,
  },
  {
    slug: "story-ideator",
    content: `---
name: story-ideator
description: Use when generating original plot seeds, synopses, chapter arcs, or scene ideas from an existing novel bible.
---

# Story Ideator

${ATTRIBUTION}

## Purpose

Generate original story ideas that fit the project's bible without copying source plots, scenes, villains, or chapter progressions.

## Required Context

- \`bible/style.md\`
- \`bible/structure.md\`
- \`bible/characters/*.md\`
- \`bible/universe/*.md\`
- \`analysis/output/*/structure.md\` when available for anti-plagiarism checks

## Workflow

1. Build \`.work/universe-context.md\` with characters, locations, tone, structure constraints, and open creative boundaries.
2. Generate 10-15 seeds using inversions, location collisions, external pressure, relationship stress tests, and genre blends.
3. Present seed options before expanding unless the user asks for direct generation.
4. Expand the selected seed into logline, MICE type, structure map, stakes, complications, climax, and resolution.
5. Compare against source structures when available and record overlap in \`.work/plagiarism-check.md\`.
6. Write \`story/synopsis.md\` and update \`story/plan.md\` only after the selected direction is clear.

## Originality Rules

- Use bible elements as constraints, not as copied plot machinery.
- Avoid mirroring source discovery methods, antagonist roles, key scenes, or resolution patterns.
- If overlap is high, return to seed generation rather than patching with superficial changes.
`,
  },
  {
    slug: "chapter-workflow",
    content: `---
name: chapter-workflow
description: Use when planning, drafting, reviewing, and finalizing a novel chapter inside a writing workspace.
---

# Chapter Workflow

${ATTRIBUTION}

## Purpose

Coordinate a chapter from current state through plan, draft, review, revision, and state update using Craft skills and project files.

## Standard Flow

1. Read \`story/synopsis.md\`, \`story/plan.md\`, \`state/current/*\`, and \`timeline/history.md\`.
2. Create \`.work/chapter-XX-plan.md\` with objective, starting point, beats, ending hook, characters, locations, objects, and revealed information.
3. Draft the chapter to \`.work/chapter-XX-draft.md\` using the plan plus relevant bible files.
4. Run style, character, and continuity review skills.
5. If a gate fails, revise the draft using only the review reports and repeat reviews. Cap automatic loops at three unless the user asks to continue.
6. Optional: run local perplexity analysis only when the project has explicitly enabled it and the required local environment exists.
7. After approval, move the final chapter into \`story/chapters/\`.
8. Use the state updater skill to create \`state/chapter-XX/\`, update \`state/current\`, and append timeline events.

## Gates

- Style review checks prose compliance against \`bible/style.md\`.
- Character review checks voice, traits, relationships, and emotional continuity.
- Continuity review checks time, space, knowledge, object, and cause-effect consistency.

## Boundaries

- Do not modify \`bible/\` during chapter drafting unless the user explicitly asks.
- Do not treat perplexity improvement as a required default gate; it is optional and environment-dependent.
- Preserve accepted manuscript text unless a requested revision targets it.
`,
  },
  {
    slug: "style-reviewer",
    content: `---
name: style-reviewer
description: Use when checking a chapter draft against a novel project's style guide.
---

# Style Reviewer

${ATTRIBUTION}

## Purpose

Validate technical style compliance for chapter drafts without judging plot quality or rewriting the chapter.

## Inputs

- Chapter draft, usually \`.work/chapter-XX-draft.md\`
- \`bible/style.md\`
- \`bible/structure.md\` when chapter openings or endings are constrained

## Review Checklist

- Point of view consistency
- Tense consistency
- Register and vocabulary constraints
- Dialogue tag and dialogue formatting rules
- Internal thought formatting
- Sentence rhythm and paragraph length ranges when specified
- Chapter opening and ending pattern when specified
- Forbidden style drift listed in the style guide

## Output

Write \`.work/chapter-XX-style-report.md\`:

- Blocking errors with exact excerpt and violated rule
- Warnings for ambiguous or borderline issues
- Statistics required by the style guide
- Verdict: \`PASS\` or \`FAIL - N blocking errors\`

## Boundaries

- Do not rewrite the manuscript.
- Do not evaluate plot, character arc, or continuity.
- If the style guide is ambiguous, classify the item as a warning rather than a blocking error.
`,
  },
  {
    slug: "character-reviewer",
    content: `---
name: character-reviewer
description: Use when checking character behavior, voice, relationships, and emotional continuity in a chapter draft.
---

# Character Reviewer

${ATTRIBUTION}

## Purpose

Verify that characters in a draft remain consistent with the bible and current state while allowing motivated growth.

## Inputs

- Chapter draft
- \`bible/characters/*.md\`
- \`state/current/characters.md\`
- Relevant relationship or knowledge notes from \`state/current/\`

## Review Checklist

- Actions match established traits or have visible pressure that explains deviation.
- Dialogue matches vocabulary, formality, rhythm, and verbal habits.
- Emotional transitions follow from previous state and chapter events.
- Characters only know what they have learned.
- Relationship dynamics respect prior state.
- Growth is earned rather than abrupt.

## Output

Write \`.work/chapter-XX-character-report.md\`:

- Major inconsistencies
- Minor inconsistencies
- Dialogue check by character
- Emotional arcs
- Verdict: \`PASS\` or \`FAIL - N major inconsistencies\`

## Boundaries

- Do not judge prose style except where it affects character voice.
- Do not rewrite dialogue; describe the expected behavior or voice target.
`,
  },
  {
    slug: "continuity-reviewer",
    content: `---
name: continuity-reviewer
description: Use when checking timeline, spatial logic, knowledge boundaries, object state, and cause-effect continuity in a chapter draft.
---

# Continuity Reviewer

${ATTRIBUTION}

## Purpose

Find contradictions between a chapter draft and established narrative state.

## Inputs

- Chapter draft
- \`state/current/situation.md\`
- \`state/current/knowledge.md\`
- \`state/current/inventory.md\` when present
- \`timeline/history.md\`

## Review Checklist

- Character locations and transitions
- Time of day, elapsed time, season, and event order
- Environmental continuity
- Character knowledge boundaries
- Object ownership, location, damage, loss, or use
- Cause and effect from prior chapters
- References to previous events

## Output

Write \`.work/chapter-XX-continuity-report.md\`:

- Continuity errors
- Timeline issues
- Knowledge violations
- Spatial issues
- Object tracking issues
- Verdict: \`PASS\` or \`FAIL - N errors\`

## Boundaries

- Do not judge prose quality, pacing, or style.
- Do not suggest creative alternatives unless needed to explain the contradiction.
`,
  },
  {
    slug: "state-updater",
    content: `---
name: state-updater
description: Use when a validated chapter needs its narrative state extracted into versioned state and timeline files.
---

# State Updater

${ATTRIBUTION}

## Purpose

Convert an accepted chapter into durable continuity records for future writing.

## Inputs

- Final chapter text
- Previous \`state/current/*\`
- \`timeline/current-chapter.md\`
- \`timeline/history.md\`

## Workflow

1. Determine the chapter number.
2. Create \`state/chapter-XX/\`.
3. Write complete \`situation.md\`, \`characters.md\`, and \`knowledge.md\` files in the new chapter directory.
4. Write \`inventory.md\` only when objects are narratively significant.
5. Update \`state/current\` to point to or mirror the new chapter state according to the platform's filesystem support.
6. Append chronological events to \`timeline/current-chapter.md\`.
7. At chapter transition, append current chapter timeline content to \`timeline/history.md\` and clear \`timeline/current-chapter.md\` only after confirming the archival step.

## Extraction Rules

- Record only explicit or strongly implied facts.
- Mark ambiguous timing as unclear instead of guessing.
- Track who knows each fact.
- Carry forward unresolved hooks unless the chapter resolves them.
- Preserve previous state facts that remain true.

## Output

Show the complete content for each created or updated state file and summarize semantic changes by manuscript, state, and timeline.
`,
  },
];

export function getBundledNovelSkillFiles(): BundledNovelSkillFile[] {
  return [
    ...SKILLS.map((skill) => ({
      relativePath: `${skill.slug}/SKILL.md`,
      content: skill.content,
    })),
    {
      relativePath: "NOTICE-Claude-Book.md",
      content: `${getClaudeBookNotice()}

Perplexity analysis from the original Claude-Book project is intentionally optional in Craft Agent. It depends on local GPU/CUDA-style resources and should be enabled only by projects that have installed and configured the required local environment.
`,
    },
  ];
}
