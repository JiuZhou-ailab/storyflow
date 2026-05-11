import { describe, expect, it } from "bun:test";
import { getBuiltInMethodPack, getBuiltInMethodPacks } from "../index.ts";

describe("built-in method packs", () => {
  it("exposes all built-in novel method pack ids", () => {
    expect(getBuiltInMethodPacks().map((pack) => pack.id)).toEqual([
      "novel.claude-book",
      "novel.oh-story",
      "novel.crucible",
      "novel.creative-writing",
    ]);
  });

  it("exposes the Claude-Book novel method pack contract", () => {
    const pack = getBuiltInMethodPack("novel.claude-book");

    expect(pack?.id).toBe("novel.claude-book");
    expect(pack?.version).toBe(1);
    expect(pack?.projectType).toBe("novel");
    expect(pack?.storageProfile).toBe("claude-book-compatible");
    expect(pack?.requiredPaths).toContainEqual({
      path: "state/current/situation.md",
      kind: "file",
    });
    expect(pack?.requiredSkills).toContain("chapter-workflow");
    expect(pack?.requiredSkills).toContain("state-updater");
    expect(pack?.starterMessage).toContain("Claude-Book");
  });

  it("exposes the Oh Story web-fiction method pack contract", () => {
    const pack = getBuiltInMethodPack("novel.oh-story");

    expect(pack?.projectType).toBe("novel");
    expect(pack?.storageProfile).toBe("oh-story-compatible");
    expect(pack?.requiredPaths).toContainEqual({
      path: "追踪/伏笔.md",
      kind: "file",
    });
    expect(pack?.requiredSkills).toContain("story-long-write");
    expect(pack?.requiredSkills).toContain("story-deslop");
    expect(pack?.starterMessage).toContain("web-fiction");
  });

  it("exposes the Crucible method pack contract", () => {
    const pack = getBuiltInMethodPack("novel.crucible");

    expect(pack?.projectType).toBe("novel");
    expect(pack?.storageProfile).toBe("crucible-compatible");
    expect(pack?.requiredPaths).toContainEqual({
      path: "planning/forge-points",
      kind: "directory",
    });
    expect(pack?.requiredSkills).toContain("crucible-writer");
    expect(pack?.starterMessage).toContain("36-beat");
  });

  it("exposes the Creative Writing Skills method pack contract", () => {
    const pack = getBuiltInMethodPack("novel.creative-writing");

    expect(pack?.projectType).toBe("novel");
    expect(pack?.storageProfile).toBe("creative-writing-compatible");
    expect(pack?.requiredPaths).toContainEqual({
      path: "kb/canon/facts.md",
      kind: "file",
    });
    expect(pack?.requiredSkills).toContain("prose-writing");
    expect(pack?.requiredSkills).toContain("kb-management");
    expect(pack?.starterMessage).toContain("knowledge base");
  });

  it("returns null for unknown method packs", () => {
    expect(getBuiltInMethodPack("unknown")).toBeNull();
  });
});
