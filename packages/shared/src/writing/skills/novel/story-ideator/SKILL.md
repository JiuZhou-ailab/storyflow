---
name: story-ideator
description: Use when generating original plot seeds, synopses, chapter arcs, or scene ideas from an existing novel bible.
---

# Story Ideator

Adapted for Craft Agent from Claude-Book concepts. Source: https://github.com/ThomasHoussin/Claude-Book

Generate original story ideas from bible constraints. Use inversion, location collision, external pressure, relationship stress tests, and anti-plagiarism checks against source structures.

## Output Contract

- Do not leave the accepted synopsis or chapter plan only in `.work/` or session plan files.
- The selected synopsis must be written to `story/synopsis.md`.
- The selected chapter count, order, titles, target length, and core beats must be written to `story/plan.md`.
- `story/plan.md` is the source of truth for later chapter generation.
