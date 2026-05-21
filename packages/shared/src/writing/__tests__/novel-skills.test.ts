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
      expect(file.content).toMatch(/^---\nname: [a-z0-9-]+\ndescription: Use when .+\n---/);
      expect(file.content).not.toContain("tools:");
      expect(file.content).not.toContain("model:");
      expect(file.content).not.toContain("Output language\nFrench");
      expect(file.content).toContain("Claude-Book");
    }
  });

  it("marks perplexity analysis as optional rather than a default gate", () => {
    const joined = getBundledNovelSkillFiles().map((file) => file.content).join("\n");

    expect(joined).toContain("perplexity");
    expect(joined).toContain("optional");
    expect(joined).not.toContain("perplexity-improver as a required gate");
  });

  it("defines hard Claude-Book workflow gates for outline-driven chapter generation", () => {
    const joined = getBundledNovelSkillFiles().map((file) => file.content).join("\n");

    expect(joined).toContain("Do not write or update `story/chapters/` until `story/synopsis.md` and `story/plan.md` contain non-template content.");
    expect(joined).toContain("The number and order of manuscript chapters must come from `story/plan.md`.");
    expect(joined).toContain("Natural prose paragraphs should usually contain 2-5 sentences.");
  });

  it("keeps reviewable SKILL.md source files in the repository", () => {
    const skillsRoot = join(import.meta.dir, "..", "skills", "novel");

    for (const slug of EXPECTED_SKILLS) {
      const skillPath = join(skillsRoot, slug, "SKILL.md");
      expect(existsSync(skillPath)).toBe(true);
      expect(readFileSync(skillPath, "utf-8")).toContain(`name: ${slug}`);
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

    createNovelProjectScaffold(rootPath, {
      title: "Short Piece",
      methodPackId: "short-form.article",
    });

    for (const slug of [
      "short-opening-designer",
      "short-golden-three",
      "short-draft-chapter",
      "short-reviser",
    ]) {
      const skillPath = join(rootPath, "skills", slug, "SKILL.md");
      expect(existsSync(skillPath)).toBe(true);
      expect(readFileSync(skillPath, "utf-8")).toContain(`name: ${slug}`);
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
    expect(router).toContain("Do not draft");

    const shortWriter = readFileSync(join(rootPath, "skills", "story-short-write", "SKILL.md"), "utf-8");
    expect(shortWriter).toContain("after the story router");
    expect(shortWriter).toContain("first ambiguous");
  });

});
