# Local novel-to-screenplay workflow

## Contents

- Responsibility boundary
- Project layout
- Lifecycle
- Story state
- Decision rules
- Recovery
- Acceptance

## Responsibility boundary

The current Storyflow Agent performs the reasoning:

- whole-story understanding;
- character and relationship extraction;
- adaptation decisions;
- per-episode screenplay drafting;
- semantic causality and continuity review.

The bundled `scripts/screenplay_project.py` performs deterministic local work:

- source normalization and author-heading-first splitting;
- project state creation;
- screenplay format validation;
- local checkpoints and confirmed restore;
- final merge.

Nothing in this workflow requires an SN2S service, URL, token, database, Redis,
or external model API. Storyflow's current model is the writer.

## Project layout

`prepare` creates:

```text
<project>/
├── project.json
├── source.txt
├── story-metadata.md
├── continuity.md
├── episodes/
│   ├── 001-source.md
│   └── ...
├── scripts/
│   ├── 001.md
│   └── ...
├── versions/
└── full-screenplay.md
```

`project.json` is the resume index. Source bodies live in `episodes/`; generated
scripts live in `scripts/`. Do not copy full source bodies into the state file.

## Lifecycle

```text
local novel
  -> extract text when needed
  -> deterministic prepare and split
  -> global story metadata
  -> continuity ledger
  -> draft one episode
  -> deterministic validation
  -> semantic causality/continuity review
  -> update continuity
  -> repeat
  -> validate all
  -> merge
```

The split is author-structure-first:

1. Prefer explicit chapter, episode, part, act, prologue, and epilogue markers.
2. Use repeated Markdown headings when explicit markers are absent.
3. Fall back to paragraph chunks of at most roughly 3,000 characters or 50
   lines.
4. Locally subdivide only structured chapters above 20,000 characters.

This preserves author boundaries without making an external model invent a
regular expression.

## Story state

Fill `story-metadata.md` once, then correct it only from source evidence. Include:

- title and premise;
- whole-story causality;
- genre, audience, era, and world rules;
- recurring locations and important objects;
- main characters: identity, goal, pressure, relationships, speech pattern,
  and non-negotiable facts.

Maintain `continuity.md` after each valid episode:

- established facts;
- current character goals and knowledge;
- relationship changes;
- injuries, possessions, locations, and time progression;
- unresolved hooks;
- a short episode result summary.

Later episodes must use this state, but source text wins when state and source
conflict.

## Decision rules

- Complete novel plus final file requested: continue through merge.
- Split inspection requested: stop after `prepare`.
- Selected episodes requested: draft and validate only those entries.
- Existing valid episode: keep it unless revision is explicit.
- Existing invalid episode: repair the smallest failing portion.
- Output directory or merged file already exists: stop and ask for a new path
  or explicit overwrite direction; bundled scripts do not overwrite it.

## Revision lifecycle

Before editing an existing script:

1. Create a checkpoint.
2. Read the current file.
3. Prepare and show an exact diff.
4. Obtain confirmation.
5. Apply the smallest change.
6. Validate format and semantics.
7. Update continuity only if story state changed.

Restore is a separate confirmed action. Never delete version snapshots
automatically.

## Recovery

- Extraction failure: keep the source untouched and report the format/page that
  could not be read.
- Split is implausible: show titles and sizes; adjust only the local split
  inputs or prepare from a corrected extracted text file.
- Episode validation failure: preserve the file, report diagnostics, and repair
  that episode.
- Semantic conflict: cite both source passages, pause affected episodes, and
  reconcile global state before proceeding.
- Interrupted run: inspect `project.json`; continue pending or invalid entries.
- Merge failure: repair missing or invalid episodes; do not emit a partial file
  as complete.

## Acceptance

A complete conversion requires:

1. `project.json` exists and describes every episode.
2. `story-metadata.md` and `continuity.md` contain source-grounded state.
3. Every episode script exists.
4. Every episode passes deterministic format validation.
5. Cross-episode causality and continuity review passes.
6. `full-screenplay.md` exists and is non-empty.
