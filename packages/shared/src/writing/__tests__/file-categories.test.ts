import { describe, expect, it } from "bun:test";
import { categorizeNovelPath } from "../file-categories.ts";

describe("categorizeNovelPath", () => {
  it("categorizes manuscript chapter files", () => {
    expect(categorizeNovelPath("story/chapters/chapter-01.md")).toBe("manuscript");
    expect(categorizeNovelPath("story\\chapters\\chapter-02.md")).toBe("manuscript");
  });

  it("categorizes story planning files as outline", () => {
    expect(categorizeNovelPath("story/plan.md")).toBe("outline");
    expect(categorizeNovelPath("story/synopsis.md")).toBe("outline");
  });

  it("categorizes bible files by section", () => {
    expect(categorizeNovelPath("bible/characters/alice.md")).toBe("characters");
    expect(categorizeNovelPath("bible/universe/paris.md")).toBe("locations");
    expect(categorizeNovelPath("bible/style.md")).toBe("style");
    expect(categorizeNovelPath("bible/structure.md")).toBe("outline");
  });

  it("categorizes state and timeline files", () => {
    expect(categorizeNovelPath("state/current/situation.md")).toBe("state");
    expect(categorizeNovelPath("timeline/history.md")).toBe("timeline");
  });

  it("categorizes analysis and work files", () => {
    expect(categorizeNovelPath("analysis/output/book/style.md")).toBe("analysis");
    expect(categorizeNovelPath(".work/chapter-01-plan.md")).toBe("work");
  });

  it("falls back to other for unknown paths", () => {
    expect(categorizeNovelPath("README.md")).toBe("other");
    expect(categorizeNovelPath("story/random-note.md")).toBe("other");
  });
});
