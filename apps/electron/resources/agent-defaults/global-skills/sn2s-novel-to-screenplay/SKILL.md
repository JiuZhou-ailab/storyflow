---
name: sn2s-novel-to-screenplay
description: Convert local TXT, Markdown, DOCX, or PDF novels directly inside Storyflow into resumable episodic vertical-screen screenplays, including deterministic splitting, story metadata, character continuity, per-episode drafting, validation, revision checkpoints, rollback, and final merge. Use whenever a user asks to turn a novel into a screenplay, short-drama scripts, episodic scripts, selected episode rewrites, or a complete screenplay project, even if they do not mention SN2S. This Skill requires no external SN2S server, backend URL, API token, or separate model configuration.
---

# SN2S Novel to Screenplay

Run the SN2S method entirely in the current Storyflow Agent. Use the current
model for analysis and screenplay writing, and use the bundled local helper
only for deterministic file operations.

Do not ask for `SN2S_BASE_URL`, `SN2S_TOKEN`, a remote service, or another
model API key. Do not call an external SN2S backend.

## Load the method

Read:

- `references/workflow.md` before preparing or resuming a project.
- `references/adaptation-policy.md` before drafting or revising screenplay text.
- `references/screenplay-format.md` before drafting, validating, or merging.

Resolve all bundled paths relative to this Skill directory.

## Use the local helper

The helper uses only the Python standard library and never accesses the
network:

```bash
python3 scripts/screenplay_project.py --help
```

Use any available Python 3 interpreter. The helper owns normalization,
deterministic splitting, format checks, local version snapshots, rollback, and
merge. The Agent owns story understanding and screenplay writing.

## Resolve the request

Require only:

1. A source novel path.
2. An output directory, or default to `<source-stem>-screenplay` beside the
   source.
3. A conversion mode. Default to `compact` when the user does not choose:
   `compact`, `aligned`, or `rich`.

Do not ask the user for choices that already have safe defaults.

Keep the source file intact. Never paste a full novel into chat.

## Prepare the project

For TXT, Markdown, or DOCX:

```bash
python3 scripts/screenplay_project.py prepare \
  /absolute/path/to/novel.txt \
  /absolute/path/to/novel-screenplay \
  --mode compact
```

For PDF, use Storyflow's normal document-reading capability to extract the
text into a temporary UTF-8 `.txt` file, then pass that file to `prepare`.
This is a local host operation; do not ask the user to install a PDF package
or configure a service.

The helper refuses to overwrite a non-empty output directory. Preserve that
guard. Read the returned `project.json` and report the detected split method,
episode count, indexes, and titles.

If the user asks to inspect or approve the split, stop here. Otherwise continue
through the complete conversion.

## Build global story state

Fill `story-metadata.md` from the prepared source:

- title;
- concise whole-story summary;
- genre and intended audience;
- world rules, era, and recurring locations;
- principal characters with identity, goal, conflict, speech pattern, and
  relationships.

Fill `continuity.md` with confirmed facts, character states, relationship
changes, unresolved hooks, and one concise summary per completed episode.

For a source too large to fit at once, process the prepared episode files in
order and merge facts into these two files. Treat source text as truth. Mark
uncertain facts instead of inventing them.

## Draft episodes

For each entry in `project.json`:

1. Read its `source_path`, `story-metadata.md`, and `continuity.md`.
2. Draft the corresponding `script_path` using
   `references/screenplay-format.md`.
3. Apply the selected mode from `references/adaptation-policy.md`.
4. Preserve main causality, character relationships, key reversals, necessary
   dialogue, names, places, institutions, and important props.
5. Update `continuity.md` with the episode outcome and remaining hooks.
6. Validate the episode:

```bash
python3 scripts/screenplay_project.py validate PROJECT_DIR EPISODE_INDEX
```

Fix validation errors before continuing. Treat length warnings as a review
signal: causality and necessary context take priority over exact ratios.

Draft sequentially by default because continuity is more valuable than raw
parallelism. For a long project, small parallel batches are acceptable only
after global metadata exists; give every worker the same metadata, the exact
episode source, and adjacent episode summaries, then perform a cross-episode
continuity pass.

Do not claim an episode is complete until its local validation status is
`valid` and the semantic review in `references/screenplay-format.md` passes.

## Merge the complete screenplay

After every episode is valid:

```bash
python3 scripts/screenplay_project.py merge PROJECT_DIR
```

The helper validates every episode again and writes `full-screenplay.md`. It
refuses partial or invalid projects and refuses to overwrite an existing
merged file.

Confirm that the merged file exists and is non-empty before reporting
completion.

## Revise and roll back

Before changing an existing episode, create a local checkpoint:

```bash
python3 scripts/screenplay_project.py checkpoint PROJECT_DIR EPISODE_INDEX
```

Read the current episode, show the exact proposed diff, and obtain confirmation
before writing. Validate after the edit.

To restore a prior version:

1. Show the exact version path and target episode.
2. Obtain separate confirmation.
3. Run:

```bash
python3 scripts/screenplay_project.py restore \
  PROJECT_DIR EPISODE_INDEX VERSION_PATH --yes
```

`--yes` records that confirmation already happened; it does not replace the
conversation step. The helper checkpoints the current file before restoring
and validates the restored episode.

## Resume and recover

Use `project.json` as the resume index:

- `pending`: not drafted;
- `invalid`: drafted but needs repair;
- `valid`: format-valid and eligible for merge.

Keep successful episode files when another episode fails. Resume only pending
or invalid episodes. Do not restart or overwrite the whole project.

If story facts conflict, stop the affected episode, cite the competing source
passages, update `continuity.md` after resolving the conflict, and revalidate
only affected scripts.

## Completion report

Return:

```text
小说转剧本
- 项目目录：<absolute project path>
- 模式：<compact|aligned|rich>
- 分集：<count>
- 已通过校验：<count>/<count>
- 完整剧本：<absolute full-screenplay.md path>
- 待处理：<only when something remains>
```

Lead with the output path. Do not dump the source novel or complete screenplay
into chat.
