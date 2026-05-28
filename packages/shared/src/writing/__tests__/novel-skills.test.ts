import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createNovelProjectScaffold } from "../novel-template.ts";
import { getBundledNovelSkillFiles } from "../novel-skills.ts";

const EXPECTED_SKILLS = [
  "book-analyzer",
  "bible-merger",
  "story-ideator",
  "chapter-workflow",
  "style-reviewer",
  "character-reviewer",
  "continuity-reviewer",
  "state-updater",
];

const EXPECTED_CLAUDE_BOOK_SKILL_NAMES: Record<string, string> = {
  "book-analyzer": "原著分析",
  "bible-merger": "项目圣经合并",
  "story-ideator": "故事构思",
  "chapter-workflow": "章节工作流",
  "style-reviewer": "风格审校",
  "character-reviewer": "人物审校",
  "continuity-reviewer": "连续性审校",
  "state-updater": "状态更新",
};

function createTempProject(): string {
  return mkdtempSync(join(tmpdir(), "craft-novel-skills-"));
}

describe("bundled writing skills", () => {
  it("defines Craft-compatible skill files with attribution", () => {
    const files = getBundledNovelSkillFiles();
    const slugs = files
      .filter((file) => file.relativePath.endsWith("/SKILL.md"))
      .map((file) => file.relativePath.split("/")[0])
      .sort();

    expect(slugs).toEqual([...EXPECTED_SKILLS].sort());

    for (const file of files.filter((entry) => entry.relativePath.endsWith("SKILL.md"))) {
      expect(file.content).toMatch(/^---\nname: .+\ndescription: .+\n---/);
      expect(file.content).not.toContain("tools:");
      expect(file.content).not.toContain("model:");
      expect(file.content).not.toContain("description: Use when");
      expect(file.content).not.toContain("Output language\nFrench");
      expect(file.content).toContain("Claude-Book");
    }
  });

  it("marks perplexity analysis as optional rather than a default gate", () => {
    const joined = getBundledNovelSkillFiles().map((file) => file.content).join("\n");

    expect(joined).toContain("perplexity");
    expect(joined).toContain("可选");
    expect(joined).not.toContain("perplexity-improver as a required gate");
  });

  it("defines hard Claude-Book workflow gates for outline-driven chapter generation", () => {
    const joined = getBundledNovelSkillFiles().map((file) => file.content).join("\n");

    expect(joined).toContain("在 `story/synopsis.md` 和 `story/plan.md` 仍是空模板前，不要写入或更新 `story/chapters/`。");
    expect(joined).toContain("正文章节数量和顺序必须来自 `story/plan.md`。");
    expect(joined).toContain("自然叙事段落通常应包含 2-5 句。");
  });

  it("keeps reviewable SKILL.md source files in the repository", () => {
    const skillsRoot = join(import.meta.dir, "..", "skills", "novel");

    for (const slug of EXPECTED_SKILLS) {
      const skillPath = join(skillsRoot, slug, "SKILL.md");
      expect(existsSync(skillPath)).toBe(true);
      const content = readFileSync(skillPath, "utf-8");
      expect(content).toContain(`name: ${EXPECTED_CLAUDE_BOOK_SKILL_NAMES[slug]}`);
      expect(content).not.toContain("description: Use when");
    }
  });

  it("seeds novel skills into a novel project scaffold", () => {
    const rootPath = createTempProject();

    createNovelProjectScaffold(rootPath, { title: "Novel Workspace" });

    for (const slug of EXPECTED_SKILLS) {
      expect(existsSync(join(rootPath, "skills", slug, "SKILL.md"))).toBe(true);
    }

    const notice = readFileSync(join(rootPath, "skills", "NOTICE-Claude-Book.md"), "utf-8");
    expect(notice).toContain("Claude-Book");
    expect(notice).toContain("MIT");
  });

  it("seeds short-form runtime skills into a short-form web-fiction scaffold", () => {
    const rootPath = createTempProject();
    const expectedSkillNames: Record<string, string> = {
      "short-opening-designer": "短篇开篇设计",
      "short-golden-three": "黄金三章规划",
      "short-draft-chapter": "短篇章节起草",
      "short-reviser": "短篇正文修订",
    };

    createNovelProjectScaffold(rootPath, {
      title: "Short Piece",
      methodPackId: "short-form.article",
    });

    for (const [slug, name] of Object.entries(expectedSkillNames)) {
      const skillPath = join(rootPath, "skills", slug, "SKILL.md");
      const content = readFileSync(skillPath, "utf-8");
      expect(existsSync(skillPath)).toBe(true);
      expect(content).toContain(`name: ${name}`);
      expect(content).not.toContain("description: Use when");
    }
  });

  it("routes broad web-fiction creation prompts through intake before drafting", () => {
    const rootPath = createTempProject();

    createNovelProjectScaffold(rootPath, {
      title: "Web Fiction",
      methodPackId: "novel.oh-story",
    });

    const router = readFileSync(join(rootPath, "skills", "story", "SKILL.md"), "utf-8");
    expect(router).toContain("写一个");
    expect(router).toContain("打脸");
    expect(router).toContain("爽文");
    expect(router).toContain("男频");
    expect(router).toContain("女频");
    expect(router).toContain("黄金三章");
    expect(router).toContain("不要从第一个模糊请求直接起草");

    const shortWriter = readFileSync(join(rootPath, "skills", "story-short-write", "SKILL.md"), "utf-8");
    expect(shortWriter).toContain("在故事路由之后使用");
    expect(shortWriter).toContain("第一个模糊");
  });

});
