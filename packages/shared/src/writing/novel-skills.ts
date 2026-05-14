// input: Built-in writing skill definitions
// output: File payloads seeded into writing workspaces
// pos: Packaged skill bundle for built-in writing Method Packs

import { getClaudeBookNotice } from "./claude-book-notice.ts";
import type { MethodPackId } from "./method-packs/types.ts";

export interface BundledNovelSkillFile {
  relativePath: string;
  content: string;
}

const ATTRIBUTION = "Adapted for Craft Agent from Claude-Book concepts. Source: https://github.com/ThomasHoussin/Claude-Book";
const OH_STORY_ATTRIBUTION = "Adapted for Craft Agent from oh-story-claudecode concepts. Source: https://github.com/worldwonderer/oh-story-claudecode";
const CRUCIBLE_ATTRIBUTION = "Adapted for Craft Agent from The Crucible Writing System For Claude concepts. Source: https://github.com/forsonny/The-Crucible-Writing-System-For-Claude";
const CREATIVE_WRITING_ATTRIBUTION = "Adapted for Craft Agent from creative-writing-skills concepts. Source: https://github.com/haowjy/creative-writing-skills";

const CLAUDE_BOOK_SKILLS: Array<{ slug: string; content: string }> = [
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

## Output Contract

- Do not leave the accepted synopsis or chapter plan only in \`.work/\` or session plan files.
- The selected synopsis must be written to \`story/synopsis.md\`.
- The selected chapter count, order, titles, target length, and core beats must be written to \`story/plan.md\`.
- \`story/plan.md\` is the source of truth for later chapter generation.

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

0. Do not write or update \`story/chapters/\` until \`story/synopsis.md\` and \`story/plan.md\` contain non-template content.
1. Read \`story/synopsis.md\`, \`story/plan.md\`, \`state/current/*\`, and \`timeline/history.md\`.
2. Create \`.work/chapter-XX-plan.md\` with objective, starting point, beats, ending hook, characters, locations, objects, and revealed information.
3. Draft the chapter to \`.work/chapter-XX-draft.md\` using the plan plus relevant bible files.
4. Run style, character, and continuity review skills.
5. If a gate fails, revise the draft using only the review reports and repeat reviews. Cap automatic loops at three unless the user asks to continue.
6. Optional: run local perplexity analysis only when the project has explicitly enabled it and the required local environment exists.
7. After approval, move the final chapter into \`story/chapters/\`.
8. Use the state updater skill to create \`state/chapter-XX/\`, update \`state/current\`, and append timeline events.

## Gates

- The number and order of manuscript chapters must come from \`story/plan.md\`.
- Do not skip planned chapters or invent extra accepted chapters outside \`story/plan.md\`.
- Natural prose paragraphs should usually contain 2-5 sentences.
- Avoid one-sentence-per-blank-line output except for dialogue, lists, or deliberate emphasis.
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

function adapterSkill({
  slug,
  title,
  description,
  attribution,
  purpose,
  context,
  workflow,
  output,
}: {
  slug: string;
  title: string;
  description: string;
  attribution: string;
  purpose: string;
  context: string[];
  workflow: string[];
  output: string[];
}): { slug: string; content: string } {
  return {
    slug,
    content: `---
name: ${slug}
description: ${description}
---

# ${title}

${attribution}

## Purpose

${purpose}

## Project Context

${context.map((item) => `- ${item}`).join("\n")}

## Workflow

${workflow.map((item, index) => `${index + 1}. ${item}`).join("\n")}

## Output

${output.map((item) => `- ${item}`).join("\n")}
`,
  };
}

const OH_STORY_SKILLS = [
  adapterSkill({
    slug: "story-setup",
    title: "Story Setup",
    description: "Use when initializing or repairing an Oh Story web-fiction workspace.",
    attribution: OH_STORY_ATTRIBUTION,
    purpose: "Prepare the web-fiction project structure and explain what must be filled before drafting.",
    context: ["设定/ contains canon.", "大纲/ contains book and chapter planning.", "追踪/ contains continuity, foreshadowing, and timeline state."],
    workflow: ["Check that required folders and starter files exist.", "Identify missing premise, platform, genre lane, benchmark, and update-cadence decisions.", "Write a concise setup checklist to .work/setup-checklist.md when project direction is still incomplete."],
    output: ["Workspace setup status.", "Next required decisions.", "Files that should be filled first."],
  }),
  adapterSkill({
    slug: "story",
    title: "Story Router",
    description: "Use when the user gives an initial or broad web-fiction request such as 写一个, 爽文, 打脸, 男频, 女频, 双男主, 腹黑, 乡村短文, 黄金三章, premise, outline, or chapter request and project direction is not fully locked.",
    attribution: OH_STORY_ATTRIBUTION,
    purpose: "Classify broad web-fiction requests into the right intake path before any outline, golden chapters, or draft.",
    context: ["This is the base intake skill for Oh Story work.", "Long-form work uses long-scan, long-analyze, and long-write after positioning is clear.", "Short-form work uses short-scan, short-analyze, and short-write after the compressed story brief is clear.", "Accepted manuscript lives in 正文/."],
    workflow: ["Do not draft from the first ambiguous request, even if the user says 写一个.", "Extract known facts from the prompt: premise, setting, protagonist, relationship, conflict, emotional engine, desired payoff, length, and platform clues.", "Identify missing method-defining dimensions: 男频/女频/无CP/双男主/双女主, 题材赛道, 打脸/逆袭/复仇/种田/悬疑/甜宠 engine, 腹黑 or straightforward characterization, POV, rhythm of reversals, ending shape, taboo constraints, and whether the user wants 大纲, 黄金三章, 分章, or prose first.", "Ask a compact set of only the blocking questions, or propose defaults explicitly when the missing choices are low-risk.", "Write or update 设定/题材定位.md and 大纲/大纲.md before routing to scan, analyze, long-write, or short-write."],
    output: ["Known constraints extracted from the prompt.", "Blocking questions or explicit defaults.", "Selected workflow and next artifact such as positioning brief, 大纲, 黄金三章 plan, or short-story beat outline."],
  }),
  adapterSkill({
    slug: "story-long-scan",
    title: "Long-Form Market Scan",
    description: "Use when researching long-form online fiction platforms, trend lanes, hooks, and reader expectations.",
    attribution: OH_STORY_ATTRIBUTION,
    purpose: "Turn market observations into structured positioning guidance for a long-form web novel.",
    context: ["Store research in 参考资料/.", "Store benchmark lists and notes in 对标/ or 拆文库/.", "Do not treat trend notes as canon until accepted into 设定/ or 大纲/."],
    workflow: ["Define target platform and genre lane.", "Collect comparable titles, hooks, update patterns, and reader promise.", "Summarize durable positioning constraints without copying plots."],
    output: ["参考资料/<topic>.md research notes.", "对标/<title>/ notes when a benchmark is selected.", "Positioning recommendations for 设定/题材定位.md."],
  }),
  adapterSkill({
    slug: "story-long-analyze",
    title: "Long-Form Benchmark Analyzer",
    description: "Use when decomposing benchmark long-form web novels into reusable structure, hooks, and pacing observations.",
    attribution: OH_STORY_ATTRIBUTION,
    purpose: "Extract non-lossy benchmark observations that can guide an original long-form work.",
    context: ["Source excerpts belong under 对标/ or 拆文库/.", "Analysis reports should keep evidence separate from interpretation.", "Original project canon remains in 设定/."],
    workflow: ["Identify opening promise, golden chapters, recurring hooks, emotional reward loop, and chapter-end propulsion.", "Record observations with source references.", "Flag patterns that should not be copied directly."],
    output: ["拆文库/<title>/拆文报告.md.", "Reusable craft observations.", "Similarity risks to avoid."],
  }),
  adapterSkill({
    slug: "story-long-write",
    title: "Long-Form Web Novel Writer",
    description: "Use when planning or drafting long-form online fiction chapters after the story router has selected the long-form path and core positioning is clear.",
    attribution: OH_STORY_ATTRIBUTION,
    purpose: "Move a long-form web novel from positioning and outline into chapter plans and manuscript.",
    context: ["Use 设定/ as canon.", "Use 大纲/ as the chapter contract.", "Use 正文/ for accepted chapters.", "Use 追踪/ after each accepted chapter."],
    workflow: ["Confirm 设定/题材定位.md and 大纲/大纲.md are non-empty before drafting.", "Create or update a chapter brief in 大纲/.", "Draft to .work/ first, then write accepted text into 正文/.", "Update 追踪/上下文.md, 追踪/伏笔.md, and 追踪/时间线.md after acceptance."],
    output: ["Chapter brief.", "Draft manuscript.", "Tracking updates."],
  }),
  adapterSkill({
    slug: "story-short-scan",
    title: "Short-Form Market Scan",
    description: "Use when researching short-form fiction platforms, compressed hooks, and emotional payoff patterns.",
    attribution: OH_STORY_ATTRIBUTION,
    purpose: "Find short-fiction opportunity spaces and translate them into original premise constraints.",
    context: ["Short-form work still uses 设定/, 大纲/, 正文/, and 追踪/.", "Research belongs in 参考资料/."],
    workflow: ["Define platform and target emotional arc.", "Collect benchmark hook, reversal, and payoff patterns.", "Summarize constraints that can shape an original short story."],
    output: ["Research notes.", "Recommended short premise lanes.", "Risks and platform constraints."],
  }),
  adapterSkill({
    slug: "story-short-analyze",
    title: "Short-Form Benchmark Analyzer",
    description: "Use when decomposing short fiction into hooks, reversals, emotional curve, and payoff mechanics.",
    attribution: OH_STORY_ATTRIBUTION,
    purpose: "Extract short-fiction craft signals without copying benchmark plot machinery.",
    context: ["Benchmark analysis belongs in 拆文库/.", "Use evidence-first extraction.", "Original story decisions belong in 大纲/."],
    workflow: ["Identify hook, setup, reversal sequence, emotional high point, and final payoff.", "Track where information is withheld or reframed.", "Convert observations into constraints for the current story."],
    output: ["拆文报告.md.", "Emotional curve notes.", "Originality warnings."],
  }),
  adapterSkill({
    slug: "story-short-write",
    title: "Short-Form Story Writer",
    description: "Use when planning, drafting, or polishing a short web-fiction story after the story router has selected the short-form path and core constraints are clear.",
    attribution: OH_STORY_ATTRIBUTION,
    purpose: "Create compact, high-payoff short fiction with clear hook, escalation, reversal, and ending.",
    context: ["Use this after the story router, not as the first response to a first ambiguous request.", "Use 大纲/ for compressed structure.", "Draft in .work/ before writing accepted text to 正文/.", "Track factual continuity in 追踪/ when the story spans multiple scenes."],
    workflow: ["If this is still the first ambiguous 写一个 request, return to the story router instead of drafting.", "Confirm premise, emotional target, reversal, and ending.", "Create a beat outline.", "Draft with tight scene economy.", "Revise for hook clarity and payoff integrity."],
    output: ["Short-story outline.", "Draft text.", "Revision notes."],
  }),
  adapterSkill({
    slug: "story-deslop",
    title: "Story Deslop",
    description: "Use when reducing generic AI prose patterns in a web-fiction draft.",
    attribution: OH_STORY_ATTRIBUTION,
    purpose: "Detect and revise generic, flattened, or over-explained prose while preserving story facts.",
    context: ["Work from .work/ drafts or 正文/ when the user explicitly asks to edit accepted manuscript.", "Do not change canon facts unless requested."],
    workflow: ["Identify repeated phrasing, abstract emotion labels, over-neat transitions, and low-specificity description.", "Revise with concrete action, sharper rhythm, and character-specific perception.", "Keep plot events and continuity unchanged."],
    output: ["Issue list.", "Revised passage or file.", "Notes on what changed semantically."],
  }),
  adapterSkill({
    slug: "story-review",
    title: "Story Review",
    description: "Use when reviewing web-fiction chapters for hook, pacing, continuity, market fit, and reader payoff.",
    attribution: OH_STORY_ATTRIBUTION,
    purpose: "Run a multi-axis review before accepting or publishing a web-fiction draft.",
    context: ["Compare against 设定/, 大纲/, and 追踪/.", "Review reports belong in .work/."],
    workflow: ["Check hook clarity, chapter propulsion, emotional payoff, poison points, continuity, and style drift.", "Separate blocking issues from polish suggestions.", "Recommend targeted revision steps."],
    output: [".work/story-review-report.md.", "Blocking issues.", "Revision priorities."],
  }),
  adapterSkill({
    slug: "story-cover",
    title: "Story Cover",
    description: "Use when generating or briefing cover concepts for a web-fiction project.",
    attribution: OH_STORY_ATTRIBUTION,
    purpose: "Translate genre lane, title promise, protagonist signal, and platform expectations into a cover brief.",
    context: ["Use 设定/题材定位.md and 大纲/ for story promise.", "Keep generated assets or prompts outside canon files."],
    workflow: ["Extract genre, protagonist, core visual, mood, and platform constraints.", "Create 2-3 distinct cover directions.", "Write final image prompt or production brief."],
    output: ["Cover concept options.", "Final prompt or brief.", "Asset path if an image is generated."],
  }),
];

const CRUCIBLE_SKILLS = [
  adapterSkill({
    slug: "crucible-planner",
    title: "Crucible Planner",
    description: "Use when turning a premise into Crucible planning documents.",
    attribution: CRUCIBLE_ATTRIBUTION,
    purpose: "Build the 36-beat foundation: thesis, three strands, forge points, mercy ledger, dark mirror, and world forge.",
    context: ["planning/ is the source of truth.", ".crucible/state/ records workflow state.", "Do not draft chapters before the planning documents are coherent."],
    workflow: ["Capture premise, protagonist, quest, internal fire, constellation, antagonist mirror, and ending promise.", "Populate planning documents with explicit unknowns instead of invented certainty.", "Check that every forge point collides the quest, fire, and constellation strands."],
    output: ["planning/crucible-thesis.md.", "Strand maps.", "Forge point and mercy ledger updates."],
  }),
  adapterSkill({
    slug: "crucible-outliner",
    title: "Crucible Outliner",
    description: "Use when converting Crucible planning documents into beat and chapter outlines.",
    attribution: CRUCIBLE_ATTRIBUTION,
    purpose: "Map the 36-beat structure into chapter-level execution without losing strand logic.",
    context: ["planning/ must be read before outline/.", "outline/master-outline.md is the chapter contract.", "outline/by-chapter/ holds detailed chapter briefs."],
    workflow: ["Read all planning documents.", "Map beats to chapters with movement percentages and forge point placement.", "Create chapter briefs with strand function, scene objective, and ending pressure."],
    output: ["outline/master-outline.md.", "outline/by-chapter/chapter-XX.md files.", "Open structural risks."],
  }),
  adapterSkill({
    slug: "crucible-writer",
    title: "Crucible Writer",
    description: "Use when drafting Crucible chapters scene by scene.",
    attribution: CRUCIBLE_ATTRIBUTION,
    purpose: "Draft chapters that follow the outline, respect planning canon, and maintain Crucible strand pressure.",
    context: ["Accepted chapters live in draft/chapters/.", "Use draft/reviews/ for review reports.", "story-bible.json and style-profile.md constrain canon and voice when populated."],
    workflow: ["Read the chapter brief and relevant planning documents.", "Draft into .work/ first.", "Verify no invented lore, beat drift, or unsupported character knowledge before accepting into draft/chapters/."],
    output: ["Chapter draft.", "Accepted chapter file when approved.", "Notes for review."],
  }),
  adapterSkill({
    slug: "crucible-editor",
    title: "Crucible Editor",
    description: "Use when revising Crucible chapters at developmental, line, or polish level.",
    attribution: CRUCIBLE_ATTRIBUTION,
    purpose: "Revise chapters while preserving the 36-beat contract, strand weave, and established style.",
    context: ["Do not edit planning documents unless the user asks for structural revision.", "Revision reports belong in draft/reviews/."],
    workflow: ["Classify the edit level.", "Check against outline and planning docs.", "Apply targeted revisions and summarize semantic changes."],
    output: ["Edited chapter or patch plan.", "draft/reviews/edit-report.md.", "Remaining risks."],
  }),
  adapterSkill({
    slug: "crucible-reviewer",
    title: "Crucible Reviewer",
    description: "Use when reviewing Crucible chapters for continuity, outline adherence, timeline, voice, and prose quality.",
    attribution: CRUCIBLE_ATTRIBUTION,
    purpose: "Catch drift early through structured chapter or bi-chapter review.",
    context: ["Review against planning/, outline/, story-bible.json, and style-profile.md.", "Reports belong in draft/reviews/."],
    workflow: ["Check beat adherence, strand progression, timeline, continuity, invented facts, voice, and prose craft.", "Separate blocking findings from recommendations.", "Record exact file references and revision targets."],
    output: ["draft/reviews/chapter-XX-review.md.", "Blocking findings.", "Suggested next edits."],
  }),
];

const CREATIVE_WRITING_SKILLS = [
  adapterSkill({
    slug: "project-setup",
    title: "Project Setup",
    description: "Use when initializing or repairing a Creative Writing Skills workspace.",
    attribution: CREATIVE_WRITING_ATTRIBUTION,
    purpose: "Create a usable writing workspace with story, work, and kb boundaries.",
    context: ["kb/ is durable knowledge.", "work/ is scratch and drafting space.", "story/chapters/ is accepted manuscript."],
    workflow: ["Inventory existing files.", "Identify missing project premise, voice references, canon, and current drafting goal.", "Write a setup checklist without overwriting user content."],
    output: ["Setup status.", "Missing inputs.", "Recommended first action."],
  }),
  adapterSkill({
    slug: "writing-principles",
    title: "Writing Principles",
    description: "Use when applying durable fiction craft principles to a story decision or draft.",
    attribution: CREATIVE_WRITING_ATTRIBUTION,
    purpose: "Evaluate choices through reader reward, immersion, specificity, social simulation, and flow.",
    context: ["Use project-specific kb/ facts before generic advice.", "Keep craft advice tied to the current passage or outline."],
    workflow: ["Identify the reader effect being targeted.", "Map the current choice to craft principles.", "Recommend the smallest revision that improves the intended effect."],
    output: ["Craft diagnosis.", "Targeted recommendations.", "Tradeoffs."],
  }),
  adapterSkill({
    slug: "prose-writing",
    title: "Prose Writing",
    description: "Use when drafting prose from a scene brief in the project's voice.",
    attribution: CREATIVE_WRITING_ATTRIBUTION,
    purpose: "Generate scene prose that respects canon, voice references, and scene-level intent.",
    context: ["Read relevant kb/ pages and work/outline files.", "Draft in work/drafts/ unless accepting into story/chapters/."],
    workflow: ["Gather scene objective, POV, location, conflict, and ending state.", "Draft with concrete sensory and emotional progression.", "Preserve all established facts."],
    output: ["Scene or chapter draft.", "Assumptions used.", "Canon updates needed."],
  }),
  adapterSkill({
    slug: "scene-construction",
    title: "Scene Construction",
    description: "Use when designing or repairing scene beats, entrances, dialogue flow, or transitions.",
    attribution: CREATIVE_WRITING_ATTRIBUTION,
    purpose: "Shape scenes so every beat changes pressure, knowledge, relationship, or commitment.",
    context: ["Scene plans belong in work/outline/.", "Accepted consequences should later move into kb/."],
    workflow: ["Define entry state and exit state.", "Break the scene into pressure beats.", "Check dialogue, action, and interiority are not doing the same job redundantly."],
    output: ["Scene beat sheet.", "Revision targets.", "Continuity implications."],
  }),
  adapterSkill({
    slug: "prose-critique",
    title: "Prose Critique",
    description: "Use when critiquing a draft for reader experience, voice, structure, and continuity.",
    attribution: CREATIVE_WRITING_ATTRIBUTION,
    purpose: "Provide adversarial but actionable critique for a draft or passage.",
    context: ["Critique reports belong in work/critique-reports/.", "Use kb/ to separate canon errors from taste judgments."],
    workflow: ["Identify the passage goal.", "Evaluate immersion, clarity, specificity, voice, continuity, and scene progression.", "Prioritize issues by reader impact."],
    output: ["Critique report.", "Top revision priorities.", "Passage-level examples."],
  }),
  adapterSkill({
    slug: "style-analysis",
    title: "Style Analysis",
    description: "Use when analyzing prose samples to create or update voice references.",
    attribution: CREATIVE_WRITING_ATTRIBUTION,
    purpose: "Extract reusable style signals from source prose without flattening them into generic adjectives.",
    context: ["Style references belong in kb/styles/.", "Keep quoted evidence separate from derived guidance."],
    workflow: ["Read representative samples.", "Measure POV, distance, rhythm, diction, dialogue, imagery, and paragraph habits.", "Write specific do and avoid rules."],
    output: ["kb/styles/<style-name>.md.", "Evidence-backed style notes.", "Open sample gaps."],
  }),
  adapterSkill({
    slug: "story-architecture",
    title: "Story Architecture",
    description: "Use when shaping arcs, outline structure, tension curves, or chapter order.",
    attribution: CREATIVE_WRITING_ATTRIBUTION,
    purpose: "Turn story intent into durable structure without prematurely locking low-level scenes.",
    context: ["Outlines belong in work/outline/ until accepted.", "Canon facts belong in kb/canon/."],
    workflow: ["Clarify protagonist desire, opposition, stakes, and transformation.", "Map arcs and pressure turns.", "Record assumptions and unresolved structural choices."],
    output: ["Outline artifact.", "Arc map.", "Decision log."],
  }),
  adapterSkill({
    slug: "story-context",
    title: "Story Context",
    description: "Use when selecting the minimum relevant context for a writing, critique, or revision task.",
    attribution: CREATIVE_WRITING_ATTRIBUTION,
    purpose: "Prevent context overload while preserving all facts needed for correctness.",
    context: ["Use kb/ as durable memory.", "Use work/ for temporary task-specific context."],
    workflow: ["Identify the target task.", "Select relevant canon, characters, style, timeline, and current draft files.", "Exclude unrelated material explicitly."],
    output: ["Context bundle summary.", "Included files.", "Excluded files and why."],
  }),
  adapterSkill({
    slug: "brainstorming",
    title: "Brainstorming",
    description: "Use when exploring plot, character, world, or revision options before committing.",
    attribution: CREATIVE_WRITING_ATTRIBUTION,
    purpose: "Generate diverse options with clear tradeoffs and source tags.",
    context: ["Brainstorm artifacts belong in work/brainstorm/.", "Accepted decisions must later move into kb/ or outline files."],
    workflow: ["Clarify the creative question.", "Generate distinct option families.", "Evaluate fit against project constraints.", "Mark any accepted direction."],
    output: ["Option set.", "Recommendation with tradeoffs.", "Accepted-decision notes."],
  }),
  adapterSkill({
    slug: "kb-management",
    title: "Knowledge Base Management",
    description: "Use when updating durable project knowledge after drafting, critique, or decisions.",
    attribution: CREATIVE_WRITING_ATTRIBUTION,
    purpose: "Keep kb/ accurate, concise, and useful for future writing sessions.",
    context: ["kb/canon/ stores established facts.", "kb/characters/ stores character profiles and current state.", "kb/timeline/ stores chronology.", "kb/issues/ stores open writing problems."],
    workflow: ["Extract only explicit or strongly implied facts.", "Update the narrowest relevant kb page.", "Preserve uncertainty and source references."],
    output: ["Updated kb files.", "Semantic change summary.", "Open questions."],
  }),
  adapterSkill({
    slug: "writing-artifacts",
    title: "Writing Artifacts",
    description: "Use when choosing where a creative artifact should live in the project.",
    attribution: CREATIVE_WRITING_ATTRIBUTION,
    purpose: "Keep temporary work, accepted manuscript, and durable knowledge in separate places.",
    context: ["story/chapters/ is accepted manuscript.", "work/ is scratch.", "kb/ is durable knowledge."],
    workflow: ["Classify the artifact by lifespan.", "Choose the target folder.", "Avoid duplicating the same truth in multiple durable files."],
    output: ["Artifact path decision.", "Reasoning.", "Follow-up updates needed."],
  }),
  adapterSkill({
    slug: "writing-issues",
    title: "Writing Issues",
    description: "Use when tracking recurring draft problems and revision tasks.",
    attribution: CREATIVE_WRITING_ATTRIBUTION,
    purpose: "Make critique findings durable enough to survive multiple revision cycles.",
    context: ["Issue files belong in kb/issues/.", "Critique reports belong in work/critique-reports/."],
    workflow: ["Extract issue, evidence, severity, owner file, and status.", "Update an existing issue when possible.", "Close issues only when the relevant draft changed."],
    output: ["Issue entries.", "Status changes.", "Next revision targets."],
  }),
  adapterSkill({
    slug: "writing-staffing",
    title: "Writing Staffing",
    description: "Use when deciding which writing, critique, brainstorming, or knowledge-maintenance roles should handle a task.",
    attribution: CREATIVE_WRITING_ATTRIBUTION,
    purpose: "Choose the minimum useful specialist workflow for a creative task.",
    context: ["Prefer direct execution for simple edits.", "Use separate roles only when their perspectives reduce real risk."],
    workflow: ["Classify task complexity.", "Select writing, critique, reader-simulation, continuity, or knowledge-maintenance roles.", "Define handoff artifacts."],
    output: ["Recommended role mix.", "Task boundaries.", "Expected artifacts."],
  }),
];

const SHORT_FORM_SKILLS: Array<{ slug: string; content: string }> = [];

export function getBundledNovelSkillFiles(methodPackId: MethodPackId = "novel.claude-book"): BundledNovelSkillFile[] {
  if (methodPackId === "novel.oh-story") {
    return OH_STORY_SKILLS.map((skill) => ({
      relativePath: `${skill.slug}/SKILL.md`,
      content: skill.content,
    }));
  }

  if (methodPackId === "novel.crucible") {
    return CRUCIBLE_SKILLS.map((skill) => ({
      relativePath: `${skill.slug}/SKILL.md`,
      content: skill.content,
    }));
  }

  if (methodPackId === "novel.creative-writing") {
    return CREATIVE_WRITING_SKILLS.map((skill) => ({
      relativePath: `${skill.slug}/SKILL.md`,
      content: skill.content,
    }));
  }

  if (methodPackId === "short-form.article") {
    return SHORT_FORM_SKILLS.map((skill) => ({
      relativePath: `${skill.slug}/SKILL.md`,
      content: skill.content,
    }));
  }

  return [
    ...CLAUDE_BOOK_SKILLS.map((skill) => ({
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
