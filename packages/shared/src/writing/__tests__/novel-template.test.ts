// input: Temporary workspace roots and built-in Method Pack selections
// output: Scaffold contract assertions for generated writing workspaces
// pos: Protects file templates and agent instructions produced by novel-template

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
      ".work/analysis/src",
      ".work/analysis/output",
      "AGENTS.md",
      "CLAUDE.md",
      "craft-pack-lock.json",
      "NOTICE-Claude-Book.md",
    ]) {
      expect(existsSync(join(rootPath, relativePath))).toBe(true);
    }
    expect(existsSync(join(rootPath, "analysis"))).toBe(false);

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
    expect(agentInstructions).toContain("## 工作流硬门禁");
    expect(agentInstructions).toContain("在 story/synopsis.md 和 story/plan.md 仍为空模板前，不要写入或更新 story/chapters/。");
    expect(agentInstructions).toContain("正文章节数量与顺序必须来自 story/plan.md。");
    expect(agentInstructions).not.toContain("Workflow Gates");
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

  it("creates a screenplay logic scaffold when selected", () => {
    const rootPath = createTempProject();

    createNovelProjectScaffold(rootPath, {
      title: "The Script",
      methodPackId: "screenplay.logic",
    });

    for (const relativePath of [
      "创作要求.md",
      "剧本/故事梗概.md",
      "剧本/分场大纲.md",
      "剧本/对白草稿",
      "角色/人物表.md",
      "场景/场景表.md",
      "逻辑/因果链.md",
      "逻辑/冲突升级.md",
      "自由区",
      "skills/script-logic-planner/SKILL.md",
      "NOTICE-Screenplay-Logic.md",
    ]) {
      expect(existsSync(join(rootPath, relativePath))).toBe(true);
    }

    const manifest = JSON.parse(readFileSync(join(rootPath, "craft-writing.json"), "utf-8"));
    expect(manifest).toMatchObject({
      type: "screenplay",
      profile: "screenplay",
      methodPack: { id: "screenplay.logic", version: 1 },
      storageProfile: "screenplay-logic-compatible",
    });

    const agents = readFileSync(join(rootPath, "AGENTS.md"), "utf-8");
    expect(agents).toContain("screenplay.logic");
    expect(agents).toContain("分场");
    expect(agents).toContain("对白");
    expect(agents).not.toContain("Crucible");
  });

  it("creates a free creation scaffold when selected", () => {
    const rootPath = createTempProject();

    createNovelProjectScaffold(rootPath, {
      title: "The Free Project",
      methodPackId: "novel.free-creation",
    });

    for (const relativePath of [
      "项目说明.md",
      "创作要求.md",
      "正文",
      "自由区",
      "参考资料",
      "NOTICE-Free-Creation.md",
    ]) {
      expect(existsSync(join(rootPath, relativePath))).toBe(true);
    }

    expect(existsSync(join(rootPath, "skills"))).toBe(false);
    expect(existsSync(join(rootPath, "kb"))).toBe(false);
    expect(existsSync(join(rootPath, "work"))).toBe(false);

    const manifest = JSON.parse(readFileSync(join(rootPath, "craft-writing.json"), "utf-8"));
    expect(manifest.methodPack).toEqual({ id: "novel.free-creation", version: 1 });
    expect(manifest.storageProfile).toBe("free-creation-compatible");

    const agents = readFileSync(join(rootPath, "AGENTS.md"), "utf-8");
    expect(agents).toContain("novel.free-creation");
    expect(agents).toContain("不强塞结构");
    expect(agents).not.toContain("Creative Writing");
  });

  it("creates a Short-Form web-fiction scaffold when selected", () => {
    const rootPath = createTempProject();

    createNovelProjectScaffold(rootPath, {
      title: "The Short Piece",
      methodPackId: "short-form.article",
    });

    for (const relativePath of [
      "创作要求.md",
      "简报.md",
      "大纲.md",
      "人物.md",
      "正文",
      "自由区",
      "NOTICE-Short-Form-Writing.md",
    ]) {
      expect(existsSync(join(rootPath, relativePath))).toBe(true);
    }

    expect(existsSync(join(rootPath, "目录说明.md"))).toBe(false);
    expect(existsSync(join(rootPath, ".work"))).toBe(false);
    expect(existsSync(join(rootPath, "草稿"))).toBe(false);
    expect(existsSync(join(rootPath, "定稿"))).toBe(false);
    expect(existsSync(join(rootPath, "短文简报.md"))).toBe(false);
    expect(existsSync(join(rootPath, "素材.md"))).toBe(false);
    expect(existsSync(join(rootPath, "素材卡.md"))).toBe(false);
    expect(existsSync(join(rootPath, "黄金三章.md"))).toBe(false);
    expect(existsSync(join(rootPath, "skills", "short-brief", "SKILL.md"))).toBe(false);
    expect(existsSync(join(rootPath, "skills", "short-drafter", "SKILL.md"))).toBe(false);

    const manifest = JSON.parse(readFileSync(join(rootPath, "craft-writing.json"), "utf-8"));
    expect(manifest).toMatchObject({
      type: "short-form",
      profile: "short-form",
      methodPack: { id: "short-form.article", version: 1 },
      storageProfile: "short-form-compatible",
    });

    const brief = readFileSync(join(rootPath, "简报.md"), "utf-8");
    expect(brief).toContain("## 题材定位");
    expect(brief).toContain("## 核心钩子");
    expect(brief).toContain("## 篇幅与生产约束");
    expect(brief).toContain("## 待确认问题");
    expect(brief).not.toContain("黄金三章");
    expect(brief).not.toContain("章首题记");
    expect(brief).not.toContain("前三段");
    expect(brief).not.toContain("高压开场");
    expect(brief).not.toContain("情绪账本");

    const outline = readFileSync(join(rootPath, "大纲.md"), "utf-8");
    expect(outline).toContain("## 全书弧线");
    expect(outline).toContain("### 第 01 章");
    expect(outline).toContain("章节目标");
    expect(outline).not.toContain("黄金三章");
    expect(outline).not.toContain("章首题记");
    expect(outline).not.toContain("前三段");

    const characters = readFileSync(join(rootPath, "人物.md"), "utf-8");
    expect(characters).toContain("## 主角");

    const requirements = readFileSync(join(rootPath, "创作要求.md"), "utf-8");
    expect(requirements).toContain("# 创作要求");
    expect(requirements).toContain("## 读者与题材偏好");
    expect(requirements).toContain("## 叙事风格偏好");
    expect(requirements).toContain("## 内容边界");
    expect(requirements).not.toContain("小说密度");
    expect(requirements).not.toContain("高压开场");
    expect(requirements).not.toContain("题记 / 引文");
    expect(requirements).not.toContain("情绪账本");

    const agents = readFileSync(join(rootPath, "AGENTS.md"), "utf-8");
    expect(agents).toContain("short-form.article");
    expect(agents).toContain("## 文件角色");
    expect(agents).toContain("## 写入边界");
    expect(agents).toContain("## Skills");
    expect(agents).toContain("简报.md");
    expect(agents).not.toContain("黄金三章.md");
    expect(agents).not.toContain("素材.md");
    expect(agents).toContain("大纲.md");
    expect(agents).toContain("正文/");
    expect(agents).toContain("自由区/");
    expect(agents).toContain("skill description");
    expect(agents).toContain("5,000-30,000");
    expect(agents).not.toContain("5,000-40,000");
    expect(agents).toContain("git diff");
    expect(agents).toContain("默认一次只写一章");
    expect(agents).toContain("用户明确要求批量生成");
    expect(agents).toContain("正文/ 可以按卷、篇或阶段建立子目录");
    expect(agents).toContain("自由区/ 可以自由创建文件和文件夹");
    expect(agents).not.toContain("原创题记");
    expect(agents).not.toContain("前三段");
    expect(agents).not.toContain("高压开场");
    expect(agents).not.toContain("情绪账本");
    expect(agents).not.toContain("第 1 章拉新");
    expect(agents).not.toContain("This project uses");
    expect(agents).not.toContain("Starter Request");
  });

});
