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

  it("categorizes Oh Story web-fiction files", () => {
    expect(categorizeNovelPath("正文/第001章_开局.md")).toBe("manuscript");
    expect(categorizeNovelPath("大纲/大纲.md")).toBe("outline");
    expect(categorizeNovelPath("设定/角色/沈栀.md")).toBe("characters");
    expect(categorizeNovelPath("设定/世界观/修真界.md")).toBe("locations");
    expect(categorizeNovelPath("设定/题材定位.md")).toBe("outline");
    expect(categorizeNovelPath("追踪/伏笔.md")).toBe("timeline");
    expect(categorizeNovelPath("参考资料/剑修.md")).toBe("analysis");
    expect(categorizeNovelPath("拆文库/对标书/拆文报告.md")).toBe("analysis");
  });

  it("categorizes Crucible files", () => {
    expect(categorizeNovelPath("draft/chapters/chapter-01.md")).toBe("manuscript");
    expect(categorizeNovelPath("draft/reviews/chapter-02-review.md")).toBe("analysis");
    expect(categorizeNovelPath("outline/master-outline.md")).toBe("outline");
    expect(categorizeNovelPath("planning/crucible-thesis.md")).toBe("outline");
    expect(categorizeNovelPath("planning/world-forge.md")).toBe("locations");
    expect(categorizeNovelPath("planning/constellation-strand-map.md")).toBe("characters");
  });

  it("categorizes Creative Writing Skills files", () => {
    expect(categorizeNovelPath("story/chapters/chapter-01.md")).toBe("manuscript");
    expect(categorizeNovelPath("work/drafts/chapter-01.md")).toBe("work");
    expect(categorizeNovelPath("kb/characters/protagonist.md")).toBe("characters");
    expect(categorizeNovelPath("kb/world/city.md")).toBe("locations");
    expect(categorizeNovelPath("kb/timeline/timeline.md")).toBe("timeline");
    expect(categorizeNovelPath("kb/canon/facts.md")).toBe("state");
    expect(categorizeNovelPath("kb/issues/open.md")).toBe("analysis");
  });

  it("falls back to other for unknown paths", () => {
    expect(categorizeNovelPath("README.md")).toBe("other");
    expect(categorizeNovelPath("story/random-note.md")).toBe("other");
  });
});
