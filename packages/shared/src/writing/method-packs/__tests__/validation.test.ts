import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createNovelProjectScaffold } from "../../novel-template.ts";
import { CLAUDE_BOOK_METHOD_PACK } from "../claude-book.ts";
import { repairMethodPackInstall, validateMethodPackInstall } from "../validation.ts";

function createTempProject(): string {
  return mkdtempSync(join(tmpdir(), "craft-method-pack-"));
}

describe("method pack validation", () => {
  it("accepts a freshly scaffolded Claude-Book project", () => {
    const rootPath = createTempProject();

    createNovelProjectScaffold(rootPath, { title: "The Test Novel" });

    expect(validateMethodPackInstall(rootPath, CLAUDE_BOOK_METHOD_PACK)).toEqual([]);
  });

  it("reports missing required paths", () => {
    const rootPath = createTempProject();
    createNovelProjectScaffold(rootPath, { title: "The Test Novel" });
    rmSync(join(rootPath, "state", "current", "situation.md"));

    expect(validateMethodPackInstall(rootPath, CLAUDE_BOOK_METHOD_PACK)).toContainEqual({
      severity: "error",
      code: "missing_path",
      path: "state/current/situation.md",
    });
  });

  it("reports missing required skills", () => {
    const rootPath = createTempProject();
    createNovelProjectScaffold(rootPath, { title: "The Test Novel" });
    rmSync(join(rootPath, "skills", "chapter-workflow", "SKILL.md"));

    expect(validateMethodPackInstall(rootPath, CLAUDE_BOOK_METHOD_PACK)).toContainEqual({
      severity: "error",
      code: "missing_skill",
      path: "skills/chapter-workflow/SKILL.md",
    });
  });

  it("repairs missing files without overwriting user content", () => {
    const rootPath = createTempProject();
    createNovelProjectScaffold(rootPath, { title: "The Test Novel" });
    const stylePath = join(rootPath, "bible", "style.md");
    writeFileSync(stylePath, "custom style");
    rmSync(join(rootPath, "state", "current", "situation.md"));
    rmSync(join(rootPath, "skills", "chapter-workflow", "SKILL.md"));

    const findings = repairMethodPackInstall(rootPath, CLAUDE_BOOK_METHOD_PACK);

    expect(findings).toEqual([]);
    expect(existsSync(join(rootPath, "state", "current", "situation.md"))).toBe(true);
    expect(existsSync(join(rootPath, "skills", "chapter-workflow", "SKILL.md"))).toBe(true);
    expect(readFileSync(stylePath, "utf-8")).toBe("custom style");
  });
});
