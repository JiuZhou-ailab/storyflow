import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createNovelProjectScaffold } from "../novel-template.ts";

function createTempProject(): string {
  return mkdtempSync(join(tmpdir(), "craft-novel-template-"));
}

describe("createNovelProjectScaffold", () => {
  it("creates the novel project file contract", () => {
    const rootPath = createTempProject();

    createNovelProjectScaffold(rootPath, {
      title: "The Test Novel",
      language: "zh-Hans",
    });

    for (const relativePath of [
      "craft-writing.json",
      "bible/style.md",
      "bible/structure.md",
      "bible/characters/_template.md",
      "bible/universe/_template.md",
      "story/synopsis.md",
      "story/plan.md",
      "story/chapters/chapter-01.md",
      "story/chapters/.gitkeep",
      "state/current/situation.md",
      "state/current/characters.md",
      "state/current/knowledge.md",
      "state/template/situation.md",
      "state/template/characters.md",
      "state/template/knowledge.md",
      "timeline/history.md",
      "timeline/current-chapter.md",
      ".work/.gitkeep",
      "AGENTS.md",
      "CLAUDE.md",
      "craft-pack-lock.json",
      "NOTICE-Claude-Book.md",
    ]) {
      expect(existsSync(join(rootPath, relativePath))).toBe(true);
    }

    const manifest = JSON.parse(readFileSync(join(rootPath, "craft-writing.json"), "utf-8"));
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      type: "novel",
      title: "The Test Novel",
      language: "zh-Hans",
      methodPack: {
        id: "novel.claude-book",
        version: 1,
      },
      storageProfile: "claude-book-compatible",
    });
    const lock = JSON.parse(readFileSync(join(rootPath, "craft-pack-lock.json"), "utf-8"));
    expect(lock.methodPack).toEqual({
      id: "novel.claude-book",
      version: 1,
    });
    expect(lock.installedSkills).toContain("chapter-workflow");
    expect(lock.installedPaths).toContain("state/current/situation.md");
    const agentInstructions = readFileSync(join(rootPath, "AGENTS.md"), "utf-8");
    expect(agentInstructions).toContain("Do not write or update story/chapters/ until story/synopsis.md and story/plan.md contain non-template content.");
    expect(agentInstructions).toContain("The number and order of manuscript chapters must come from story/plan.md.");
    expect(readFileSync(join(rootPath, "story/chapters/chapter-01.md"), "utf-8"))
      .toContain("# Chapter 1");
  });

  it("does not overwrite existing user-authored files", () => {
    const rootPath = createTempProject();
    const stylePath = join(rootPath, "bible", "style.md");
    mkdirSync(join(rootPath, "bible"), { recursive: true });
    writeFileSync(stylePath, "custom style");

    createNovelProjectScaffold(rootPath, { title: "The Test Novel" });

    expect(readFileSync(stylePath, "utf-8")).toBe("custom style");
  });

  it("does not add a starter chapter when manuscript files already exist", () => {
    const rootPath = createTempProject();
    const chapterDir = join(rootPath, "story", "chapters");
    mkdirSync(chapterDir, { recursive: true });
    writeFileSync(join(chapterDir, "prologue.md"), "# Prologue\n");

    createNovelProjectScaffold(rootPath, { title: "The Test Novel" });

    expect(existsSync(join(chapterDir, "chapter-01.md"))).toBe(false);
    expect(readFileSync(join(chapterDir, "prologue.md"), "utf-8")).toBe("# Prologue\n");
  });

  it("writes Claude-Book attribution notice", () => {
    const rootPath = createTempProject();

    createNovelProjectScaffold(rootPath, { title: "The Test Novel" });

    const notice = readFileSync(join(rootPath, "NOTICE-Claude-Book.md"), "utf-8");
    expect(notice).toContain("https://github.com/ThomasHoussin/Claude-Book");
    expect(notice).toContain("MIT");
    expect(notice).toContain("3fdebbb576b1be6d123b48258d2310c5dff013c4");
  });

  it("creates an Oh Story web-fiction scaffold when selected", () => {
    const rootPath = createTempProject();

    createNovelProjectScaffold(rootPath, {
      title: "The Web Novel",
      methodPackId: "novel.oh-story",
    });

    for (const relativePath of [
      "设定/世界观",
      "设定/角色",
      "设定/势力",
      "设定/关系.md",
      "设定/题材定位.md",
      "大纲/大纲.md",
      "正文",
      "对标",
      "拆文库",
      "追踪/上下文.md",
      "追踪/伏笔.md",
      "追踪/时间线.md",
      "参考资料",
      "skills/story-long-write/SKILL.md",
      "skills/story-deslop/SKILL.md",
      "NOTICE-Oh-Story.md",
    ]) {
      expect(existsSync(join(rootPath, relativePath))).toBe(true);
    }

    const manifest = JSON.parse(readFileSync(join(rootPath, "craft-writing.json"), "utf-8"));
    expect(manifest.methodPack).toEqual({ id: "novel.oh-story", version: 1 });
    expect(manifest.storageProfile).toBe("oh-story-compatible");
  });

  it("creates a Crucible scaffold when selected", () => {
    const rootPath = createTempProject();

    createNovelProjectScaffold(rootPath, {
      title: "The Crucible Novel",
      methodPackId: "novel.crucible",
    });

    for (const relativePath of [
      ".crucible/state/planning-state.json",
      "planning/CLAUDE.md",
      "planning/crucible-thesis.md",
      "planning/quest-strand-map.md",
      "planning/fire-strand-map.md",
      "planning/constellation-strand-map.md",
      "planning/forge-points",
      "planning/mercy-ledger.md",
      "planning/dark-mirror-profile.md",
      "planning/world-forge.md",
      "outline/master-outline.md",
      "outline/by-chapter",
      "draft/chapters",
      "draft/reviews",
      "story-bible.json",
      "style-profile.md",
      "skills/crucible-writer/SKILL.md",
      "NOTICE-Crucible.md",
    ]) {
      expect(existsSync(join(rootPath, relativePath))).toBe(true);
    }

    const manifest = JSON.parse(readFileSync(join(rootPath, "craft-writing.json"), "utf-8"));
    expect(manifest.methodPack).toEqual({ id: "novel.crucible", version: 1 });
    expect(manifest.storageProfile).toBe("crucible-compatible");
  });

  it("creates a Creative Writing Skills scaffold when selected", () => {
    const rootPath = createTempProject();

    createNovelProjectScaffold(rootPath, {
      title: "The Creative Novel",
      methodPackId: "novel.creative-writing",
    });

    for (const relativePath of [
      "story/chapters",
      "work/outline",
      "work/drafts",
      "work/critique-reports",
      "work/brainstorm",
      "kb/styles",
      "kb/characters",
      "kb/world",
      "kb/timeline/timeline.md",
      "kb/canon/facts.md",
      "kb/issues",
      "skills/prose-writing/SKILL.md",
      "skills/kb-management/SKILL.md",
      "NOTICE-Creative-Writing-Skills.md",
    ]) {
      expect(existsSync(join(rootPath, relativePath))).toBe(true);
    }

    const manifest = JSON.parse(readFileSync(join(rootPath, "craft-writing.json"), "utf-8"));
    expect(manifest.methodPack).toEqual({ id: "novel.creative-writing", version: 1 });
    expect(manifest.storageProfile).toBe("creative-writing-compatible");
  });
});
