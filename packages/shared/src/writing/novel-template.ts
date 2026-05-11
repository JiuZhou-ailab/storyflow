// input: Workspace root path, optional novel metadata, and selected Method Pack
// output: Idempotent novel project scaffold for built-in writing method packs
// pos: Scaffold creator for project-level creative writing environments

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getClaudeBookNotice } from "./claude-book-notice.ts";
import {
  CLAUDE_BOOK_METHOD_PACK,
  getBuiltInMethodPack,
  type MethodPack,
  type MethodPackId,
} from "./method-packs/index.ts";
import { getBundledNovelSkillFiles } from "./novel-skills.ts";
import type { WritingProjectManifest } from "./types.ts";

export interface CreateNovelProjectScaffoldOptions {
  title?: string;
  language?: string;
  methodPackId?: MethodPackId;
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

function hasManuscriptFile(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    return readdirSync(path, { withFileTypes: true }).some((entry) =>
      entry.isFile()
      && !entry.name.startsWith(".")
      && entry.name.toLowerCase().endsWith(".md")
    );
  } catch {
    return false;
  }
}

function resolveMethodPack(methodPackId?: MethodPackId): MethodPack {
  const pack = getBuiltInMethodPack(methodPackId ?? CLAUDE_BOOK_METHOD_PACK.id);
  if (!pack) {
    throw new Error(`Unknown method pack: ${methodPackId}`);
  }
  return pack;
}

function createManifest(
  options: CreateNovelProjectScaffoldOptions,
  pack: MethodPack
): WritingProjectManifest {
  return {
    schemaVersion: 1,
    type: "novel",
    title: options.title,
    language: options.language,
    profile: "novel",
    methodPack: {
      id: pack.id,
      version: pack.version,
    },
    storageProfile: pack.storageProfile,
  };
}

function createPackLock(pack: MethodPack): string {
  return `${JSON.stringify({
    methodPack: {
      id: pack.id,
      version: pack.version,
    },
    source: pack.source,
    installedSkills: pack.requiredSkills,
    installedPaths: pack.requiredPaths.map((path) => path.path),
  }, null, 2)}\n`;
}

function createClaudeBookAgentInstructions(): string {
  return `# Claude-Book Novel Method Pack

This project uses the novel.claude-book method pack.

- Treat bible/ as canon.
- Treat story/chapters/ as manuscript.
- Treat story/synopsis.md and story/plan.md as outline.
- Treat state/current/ as current continuity state.
- Treat timeline/history.md as append-only chronology.
- Use .work/ for drafts and review reports.

## Hard Workflow Gates

- Do not write or update story/chapters/ until story/synopsis.md and story/plan.md contain non-template content.
- The number and order of manuscript chapters must come from story/plan.md.
- Draft each chapter through .work/chapter-XX-plan.md and .work/chapter-XX-draft.md before accepting it into story/chapters/.
- After each accepted chapter, update state/current/ and timeline/ before starting the next chapter.
- Natural prose paragraphs should usually contain 2-5 sentences. Avoid one-sentence-per-blank-line output except for dialogue, lists, or deliberate emphasis.

Do not modify bible/ during chapter drafting unless explicitly requested.
`;
}

function createAgentInstructions(pack: MethodPack): string {
  if (pack.id === "novel.claude-book") {
    return createClaudeBookAgentInstructions();
  }

  return `# ${pack.displayName}

This project uses the ${pack.id} method pack.

${pack.runtimePreamble}

## Workflow Gates

- Keep accepted manuscript separate from drafts and scratch work.
- Record durable story facts in the pack's canon or knowledge files before relying on them later.
- Do not overwrite existing project files when repairing the scaffold.
- Keep analysis, benchmark, critique, and research artifacts out of accepted manuscript files unless explicitly requested.

## Starter Request

${pack.starterMessage}
`;
}

function getNoticeFileName(pack: MethodPack): string {
  switch (pack.id) {
    case "novel.claude-book":
      return "NOTICE-Claude-Book.md";
    case "novel.oh-story":
      return "NOTICE-Oh-Story.md";
    case "novel.crucible":
      return "NOTICE-Crucible.md";
    case "novel.creative-writing":
      return "NOTICE-Creative-Writing-Skills.md";
  }
}

function createNotice(pack: MethodPack): string {
  if (pack.id === "novel.claude-book") {
    return getClaudeBookNotice();
  }

  return `# ${pack.source.name} Notice

This project includes a Craft Agent method-pack adapter inspired by ${pack.source.name}.

- Source: ${pack.source.url}
- Inspected commit: ${pack.source.inspectedCommit}
- Upstream license: ${pack.source.license}

The scaffold and bundled skills in this workspace rewrite the workflow concepts for Craft Agent's workspace and skill model. Upstream license terms continue to apply to adapted concepts and any upstream material a project owner chooses to copy in separately.
`;
}

function scaffoldClaudeBook(rootPath: string): void {
  for (const dir of [
    "bible/characters",
    "bible/universe",
    "story/chapters",
    "state/current",
    "state/template",
    "timeline",
    "analysis/src",
    "analysis/output",
    ".work",
  ]) {
    ensureDir(join(rootPath, dir));
  }

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
  const chaptersPath = join(rootPath, "story/chapters");
  if (!hasManuscriptFile(chaptersPath)) {
    writeFileIfMissing(join(chaptersPath, "chapter-01.md"), `# Chapter 1

`);
  }
  writeFileIfMissing(join(rootPath, "story/chapters/.gitkeep"), "");
  writeFileIfMissing(join(rootPath, ".work/.gitkeep"), "");
  writeFileIfMissing(join(rootPath, "state/current/situation.md"), `# Current Situation

## Immediate Context

## What Just Happened

## Immediate Problem

## Open Hooks
`);
  writeFileIfMissing(join(rootPath, "state/current/characters.md"), `# Character States

## Characters
`);
  writeFileIfMissing(join(rootPath, "state/current/knowledge.md"), `# Knowledge State

## Known To All

## Known To Specific Characters

## Unknown
`);
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

function scaffoldOhStory(rootPath: string): void {
  for (const dir of [
    "设定/世界观",
    "设定/角色",
    "设定/势力",
    "大纲",
    "正文",
    "对标",
    "拆文库",
    "追踪",
    "参考资料",
    ".work",
  ]) {
    ensureDir(join(rootPath, dir));
  }

  writeFileIfMissing(join(rootPath, "设定/关系.md"), `# Relationships

## Character Map
`);
  writeFileIfMissing(join(rootPath, "设定/题材定位.md"), `# Genre Positioning

## Platform

## Genre Lane

## Core Hook

## Target Reader Promise

## Benchmarks
`);
  writeFileIfMissing(join(rootPath, "大纲/大纲.md"), `# Master Outline

## Volumes

## Chapter Plan
`);
  writeFileIfMissing(join(rootPath, "追踪/上下文.md"), `# Writing Context

## Current Position

## Active Constraints
`);
  writeFileIfMissing(join(rootPath, "追踪/伏笔.md"), `# Foreshadowing Tracker

| Setup | Location | Status | Payoff |
| --- | --- | --- | --- |
`);
  writeFileIfMissing(join(rootPath, "追踪/时间线.md"), `# Timeline
`);
  for (const dir of ["正文", "对标", "拆文库", "参考资料", ".work"]) {
    writeFileIfMissing(join(rootPath, dir, ".gitkeep"), "");
  }
}

function scaffoldCrucible(rootPath: string): void {
  for (const dir of [
    ".crucible/state",
    "planning/forge-points",
    "outline/by-chapter",
    "draft/chapters",
    "draft/reviews",
    ".work",
  ]) {
    ensureDir(join(rootPath, dir));
  }

  writeFileIfMissing(join(rootPath, ".crucible/state/planning-state.json"), `${JSON.stringify({
    phase: "planning",
    completedDocuments: [],
  }, null, 2)}\n`);
  writeFileIfMissing(join(rootPath, "planning/CLAUDE.md"), `# Crucible Planning Context

Use planning documents as canon for outline and draft work.
`);
  writeFileIfMissing(join(rootPath, "planning/crucible-thesis.md"), `# Crucible Thesis

## Core Forging Question

## Quest Strand

## Fire Strand

## Constellation Strand
`);
  writeFileIfMissing(join(rootPath, "planning/quest-strand-map.md"), `# Quest Strand Map
`);
  writeFileIfMissing(join(rootPath, "planning/fire-strand-map.md"), `# Fire Strand Map
`);
  writeFileIfMissing(join(rootPath, "planning/constellation-strand-map.md"), `# Constellation Strand Map
`);
  writeFileIfMissing(join(rootPath, "planning/forge-points/README.md"), `# Forge Points

## Ignition Forge

## First Crucible

## Second Crucible

## Third Crucible

## Apex Willed Surrender
`);
  writeFileIfMissing(join(rootPath, "planning/mercy-ledger.md"), `# Mercy Ledger

| Act | Cost | Witness | Payoff |
| --- | --- | --- | --- |
`);
  writeFileIfMissing(join(rootPath, "planning/dark-mirror-profile.md"), `# Dark Mirror Profile
`);
  writeFileIfMissing(join(rootPath, "planning/world-forge.md"), `# World Forge
`);
  writeFileIfMissing(join(rootPath, "outline/master-outline.md"), `# Master Outline

## Movements

## 36 Beats

## Chapter Map
`);
  writeFileIfMissing(join(rootPath, "story-bible.json"), `${JSON.stringify({
    characters: [],
    locations: [],
    rules: [],
  }, null, 2)}\n`);
  writeFileIfMissing(join(rootPath, "style-profile.md"), `# Style Profile

## Voice

## Prose Rules
`);
  for (const dir of ["outline/by-chapter", "draft/chapters", "draft/reviews", ".work"]) {
    writeFileIfMissing(join(rootPath, dir, ".gitkeep"), "");
  }
}

function scaffoldCreativeWriting(rootPath: string): void {
  for (const dir of [
    "story/chapters",
    "work/outline",
    "work/drafts",
    "work/critique-reports",
    "work/brainstorm",
    "kb/styles",
    "kb/characters",
    "kb/world",
    "kb/timeline",
    "kb/canon",
    "kb/issues",
  ]) {
    ensureDir(join(rootPath, dir));
  }

  writeFileIfMissing(join(rootPath, "story/README.md"), `# Story

Accepted manuscript lives under story/chapters/.
`);
  writeFileIfMissing(join(rootPath, "work/README.md"), `# Work

Temporary outlines, drafts, critique reports, and brainstorm artifacts live here.
`);
  writeFileIfMissing(join(rootPath, "kb/README.md"), `# Knowledge Base

Durable project knowledge lives here. Keep it concise, factual, and source-aware.
`);
  writeFileIfMissing(join(rootPath, "kb/timeline/timeline.md"), `# Timeline
`);
  writeFileIfMissing(join(rootPath, "kb/canon/facts.md"), `# Canon Facts

## Established

## Unresolved
`);
  for (const dir of [
    "story/chapters",
    "work/outline",
    "work/drafts",
    "work/critique-reports",
    "work/brainstorm",
    "kb/styles",
    "kb/characters",
    "kb/world",
    "kb/issues",
  ]) {
    writeFileIfMissing(join(rootPath, dir, ".gitkeep"), "");
  }
}

function scaffoldPackSpecificFiles(rootPath: string, pack: MethodPack): void {
  switch (pack.id) {
    case "novel.claude-book":
      scaffoldClaudeBook(rootPath);
      return;
    case "novel.oh-story":
      scaffoldOhStory(rootPath);
      return;
    case "novel.crucible":
      scaffoldCrucible(rootPath);
      return;
    case "novel.creative-writing":
      scaffoldCreativeWriting(rootPath);
      return;
  }
}

export function createNovelProjectScaffold(
  rootPath: string,
  options: CreateNovelProjectScaffoldOptions = {}
): void {
  const pack = resolveMethodPack(options.methodPackId);

  scaffoldPackSpecificFiles(rootPath, pack);

  writeFileIfMissing(
    join(rootPath, "craft-writing.json"),
    `${JSON.stringify(createManifest(options, pack), null, 2)}\n`
  );
  writeFileIfMissing(join(rootPath, "craft-pack-lock.json"), createPackLock(pack));
  writeFileIfMissing(join(rootPath, "AGENTS.md"), createAgentInstructions(pack));
  writeFileIfMissing(join(rootPath, "CLAUDE.md"), createAgentInstructions(pack));
  writeFileIfMissing(join(rootPath, getNoticeFileName(pack)), createNotice(pack));

  for (const file of getBundledNovelSkillFiles(pack.id)) {
    writeFileIfMissing(join(rootPath, "skills", file.relativePath), file.content);
  }
}
