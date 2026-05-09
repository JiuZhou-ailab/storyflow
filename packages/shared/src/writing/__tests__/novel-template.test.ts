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
      "story/chapters/.gitkeep",
      "state/template/situation.md",
      "state/template/characters.md",
      "state/template/knowledge.md",
      "timeline/history.md",
      "timeline/current-chapter.md",
      ".work/.gitkeep",
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
    });
  });

  it("does not overwrite existing user-authored files", () => {
    const rootPath = createTempProject();
    const stylePath = join(rootPath, "bible", "style.md");
    mkdirSync(join(rootPath, "bible"), { recursive: true });
    writeFileSync(stylePath, "custom style");

    createNovelProjectScaffold(rootPath, { title: "The Test Novel" });

    expect(readFileSync(stylePath, "utf-8")).toBe("custom style");
  });

  it("writes Claude-Book attribution notice", () => {
    const rootPath = createTempProject();

    createNovelProjectScaffold(rootPath, { title: "The Test Novel" });

    const notice = readFileSync(join(rootPath, "NOTICE-Claude-Book.md"), "utf-8");
    expect(notice).toContain("https://github.com/ThomasHoussin/Claude-Book");
    expect(notice).toContain("MIT");
    expect(notice).toContain("3fdebbb576b1be6d123b48258d2310c5dff013c4");
  });
});
