import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createNovelProjectScaffold } from "../../novel-template.ts";
import { validateClaudeBookDraftContract } from "../draft-contract.ts";

function createTempProject(): string {
  return mkdtempSync(join(tmpdir(), "craft-claude-book-draft-"));
}

function writeProjectFile(rootPath: string, relativePath: string, content: string): void {
  const filePath = join(rootPath, relativePath);
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, content);
}

function writeChapter(rootPath: string, chapterNumber: number, paragraphCount = 12): void {
  const paragraphs = Array.from({ length: paragraphCount }, (_, index) => {
    const beat = index + 1;
    return `This is chapter ${chapterNumber}, beat ${beat}. It carries the planned scene forward with concrete action. The paragraph has enough prose to avoid sentence-per-line manuscript formatting.`;
  });

  writeProjectFile(
    rootPath,
    `story/chapters/chapter-${String(chapterNumber).padStart(2, "0")}.md`,
    `# Chapter ${chapterNumber}\n\n${paragraphs.join("\n\n")}\n`
  );
}

function writeCompleteOutline(rootPath: string, chapterCount: number): void {
  const chapters = Array.from({ length: chapterCount }, (_, index) => {
    const chapterNumber = index + 1;
    return `#### Chapter ${chapterNumber}: Planned Beat\n\n- Objective: Move arc ${chapterNumber} forward.\n- Ending hook: Keep continuity for chapter ${chapterNumber + 1}.`;
  });

  writeProjectFile(
    rootPath,
    "story/synopsis.md",
    "# Synopsis\n\n## Logline\n\nA complete test novel follows a planned survival arc.\n\n## Setup\n\nThe protagonist enters a constrained world.\n\n## Conflict\n\nEvery chapter escalates the core pressure.\n\n## Resolution\n\nThe final chapter resolves the arc.\n"
  );
  writeProjectFile(rootPath, "story/plan.md", `# Chapter Plan\n\n## Chapters\n\n${chapters.join("\n\n")}\n`);
}

function writeContinuityState(rootPath: string): void {
  writeProjectFile(
    rootPath,
    "state/current/situation.md",
    "# Current Situation\n\n## Immediate Context\n\nThe latest accepted chapter ended with the group safe but under pressure.\n"
  );
  writeProjectFile(
    rootPath,
    "state/current/characters.md",
    "# Character States\n\n## Characters\n\n- Protagonist: committed to the next planned action.\n"
  );
  writeProjectFile(
    rootPath,
    "state/current/knowledge.md",
    "# Knowledge State\n\n## Known To All\n\nThe central threat is now visible to the cast.\n"
  );
  writeProjectFile(
    rootPath,
    "timeline/history.md",
    "# Timeline History\n\n- Chapter 1: The inciting problem begins.\n- Chapter 2: The protagonist commits to the plan.\n"
  );
  writeProjectFile(
    rootPath,
    "timeline/current-chapter.md",
    "# Current Chapter Timeline\n\n- Current accepted scene state is ready for the next chapter.\n"
  );
}

describe("Claude-Book draft contract validation", () => {
  it("accepts a complete 30k-word shaped Claude-Book draft", () => {
    const rootPath = createTempProject();
    createNovelProjectScaffold(rootPath, { title: "The Contract Novel" });
    writeCompleteOutline(rootPath, 15);
    writeContinuityState(rootPath);

    for (let chapterNumber = 1; chapterNumber <= 15; chapterNumber += 1) {
      writeChapter(rootPath, chapterNumber, 18);
    }

    expect(validateClaudeBookDraftContract(rootPath)).toEqual([]);
  });

  it("flags manuscripts generated before synopsis and plan are filled", () => {
    const rootPath = createTempProject();
    createNovelProjectScaffold(rootPath, { title: "Bypassed Outline" });
    writeChapter(rootPath, 1);

    expect(validateClaudeBookDraftContract(rootPath)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "manuscript_without_outline",
          path: "story/plan.md",
        }),
        expect.objectContaining({
          severity: "error",
          code: "manuscript_without_outline",
          path: "story/synopsis.md",
        }),
      ])
    );
  });

  it("uses story/plan.md as the chapter count and order contract", () => {
    const rootPath = createTempProject();
    createNovelProjectScaffold(rootPath, { title: "Missing Chapters" });
    writeCompleteOutline(rootPath, 6);
    writeContinuityState(rootPath);
    writeChapter(rootPath, 1);
    writeChapter(rootPath, 2);
    writeChapter(rootPath, 4);

    expect(validateClaudeBookDraftContract(rootPath)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "missing_planned_chapter",
          path: "story/chapters/chapter-03.md",
        }),
        expect.objectContaining({
          severity: "error",
          code: "missing_planned_chapter",
          path: "story/chapters/chapter-05.md",
        }),
        expect.objectContaining({
          severity: "error",
          code: "missing_planned_chapter",
          path: "story/chapters/chapter-06.md",
        }),
      ])
    );
  });

  it("warns on sentence-per-paragraph manuscript formatting", () => {
    const rootPath = createTempProject();
    createNovelProjectScaffold(rootPath, { title: "Choppy Draft" });
    writeCompleteOutline(rootPath, 1);
    writeContinuityState(rootPath);
    writeProjectFile(
      rootPath,
      "story/chapters/chapter-01.md",
      `# Chapter 1\n\nA short line.\n\nAnother short line.\n\nOne more short line.\n\nA final short line.\n`
    );

    expect(validateClaudeBookDraftContract(rootPath)).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        code: "choppy_paragraph_format",
        path: "story/chapters/chapter-01.md",
      })
    );
  });
});
