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

describe("bundled novel skills", () => {
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
});
