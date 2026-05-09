// input: Workspace root path and optional novel metadata
// output: Idempotent Claude-Book-compatible novel project scaffold
// pos: Scaffold creator for the first writing project profile

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getClaudeBookNotice } from "./claude-book-notice.ts";
import type { WritingProjectManifest } from "./types.ts";

export interface CreateNovelProjectScaffoldOptions {
  title?: string;
  language?: string;
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function writeFileIfMissing(path: string, content: string): void {
  ensureDir(dirname(path));
  if (!existsSync(path)) {
    writeFileSync(path, content);
  }
}

function createManifest(options: CreateNovelProjectScaffoldOptions): WritingProjectManifest {
  return {
    schemaVersion: 1,
    type: "novel",
    title: options.title,
    language: options.language,
    profile: "novel",
  };
}

export function createNovelProjectScaffold(
  rootPath: string,
  options: CreateNovelProjectScaffoldOptions = {}
): void {
  for (const dir of [
    "bible/characters",
    "bible/universe",
    "story/chapters",
    "state/template",
    "timeline",
    "analysis/src",
    "analysis/output",
    ".work",
  ]) {
    ensureDir(join(rootPath, dir));
  }

  writeFileIfMissing(
    join(rootPath, "craft-writing.json"),
    `${JSON.stringify(createManifest(options), null, 2)}\n`
  );
  writeFileIfMissing(join(rootPath, "NOTICE-Claude-Book.md"), getClaudeBookNotice());

  writeFileIfMissing(join(rootPath, "bible/style.md"), `# Style Guide

## Voice

## Point of View

## Tense

## Dialogue

## Constraints
`);
  writeFileIfMissing(join(rootPath, "bible/structure.md"), `# Narrative Structure

## Chapter Pattern

## Pacing

## Openings

## Endings
`);
  writeFileIfMissing(join(rootPath, "bible/characters/_template.md"), `# Character Name

## Identity

## Role

## Traits

## Voice

## Relationships
`);
  writeFileIfMissing(join(rootPath, "bible/universe/_template.md"), `# Location Name

## Description

## Atmosphere

## Story Function
`);
  writeFileIfMissing(join(rootPath, "story/synopsis.md"), `# Synopsis

## Logline

## Setup

## Conflict

## Resolution
`);
  writeFileIfMissing(join(rootPath, "story/plan.md"), `# Chapter Plan

## Chapters
`);
  writeFileIfMissing(join(rootPath, "story/chapters/.gitkeep"), "");
  writeFileIfMissing(join(rootPath, ".work/.gitkeep"), "");
  writeFileIfMissing(join(rootPath, "state/template/situation.md"), `# Current Situation

## Immediate Context

## What Just Happened

## Immediate Problem

## Open Hooks
`);
  writeFileIfMissing(join(rootPath, "state/template/characters.md"), `# Character States

## Characters
`);
  writeFileIfMissing(join(rootPath, "state/template/knowledge.md"), `# Knowledge State

## Known To All

## Known To Specific Characters

## Unknown
`);
  writeFileIfMissing(join(rootPath, "timeline/history.md"), `# Timeline History
`);
  writeFileIfMissing(join(rootPath, "timeline/current-chapter.md"), `# Current Chapter Timeline
`);
}
