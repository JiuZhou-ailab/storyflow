import { describe, expect, it } from "bun:test";
import {
  getBuiltInMethodPack,
  getBuiltInMethodPacks,
  getBuiltInWorkspaceProfile,
  getBuiltInWorkspaceProfiles,
  type WorkspaceProfile,
  type WorkspaceProfileId,
} from "../index.ts";

describe("built-in method packs", () => {
  it("exposes all built-in writing method pack ids", () => {
    expect(getBuiltInMethodPacks().map((pack) => pack.id)).toEqual([
      "short-form.article",
      "novel.claude-book",
      "screenplay.logic",
      "novel.free-creation",
    ]);
  });

  it("exposes workspace profile aliases for the method pack registry", () => {
    const profileId: WorkspaceProfileId = "short-form.article";
    const profile: WorkspaceProfile | null = getBuiltInWorkspaceProfile(profileId);

    expect(getBuiltInWorkspaceProfiles()).toBe(getBuiltInMethodPacks());
    expect(profile).toBe(getBuiltInMethodPack(profileId));
  });

  it("exposes the long-form novel method pack contract", () => {
    const pack = getBuiltInMethodPack("novel.claude-book");

    expect(pack?.id).toBe("novel.claude-book");
    expect(pack?.displayName).toBe("长文小说");
    expect(pack?.version).toBe(1);
    expect(pack?.projectType).toBe("novel");
    expect(pack?.storageProfile).toBe("claude-book-compatible");
    expect(pack?.requiredPaths).toContainEqual({
      path: "state/current/situation.md",
      kind: "file",
    });
    expect(pack?.requiredPaths).not.toContainEqual({
      path: "analysis/src",
      kind: "directory",
    });
    expect(pack?.requiredPaths).not.toContainEqual({
      path: "analysis/output",
      kind: "directory",
    });
    expect(pack?.requiredPaths).toContainEqual({
      path: ".work/analysis/src",
      kind: "directory",
    });
    expect(pack?.requiredPaths).toContainEqual({
      path: ".work/analysis/output",
      kind: "directory",
    });
    expect(pack?.requiredSkills).toContain("chapter-workflow");
    expect(pack?.requiredSkills).toContain("state-updater");
    expect(pack?.starterMessage).toContain("长篇小说");
  });

  it("exposes the screenplay logic method pack contract", () => {
    const pack = getBuiltInMethodPack("screenplay.logic");

    expect(pack?.displayName).toBe("剧本逻辑");
    expect(pack?.projectType).toBe("screenplay");
    expect(pack?.storageProfile).toBe("screenplay-logic-compatible");
    expect(pack?.requiredPaths).toContainEqual({
      path: "剧本/分场大纲.md",
      kind: "file",
    });
    expect(pack?.requiredSkills).toContain("script-logic-planner");
    expect(pack?.starterMessage).toContain("剧本");
  });

  it("exposes the free creation method pack contract", () => {
    const pack = getBuiltInMethodPack("novel.free-creation");

    expect(pack?.displayName).toBe("自由创作");
    expect(pack?.projectType).toBe("novel");
    expect(pack?.storageProfile).toBe("free-creation-compatible");
    expect(pack?.requiredPaths).toContainEqual({
      path: "自由区",
      kind: "directory",
    });
    expect(pack?.requiredPaths).toContainEqual({
      path: "正文",
      kind: "directory",
    });
    expect(pack?.requiredPaths).toContainEqual({
      path: "项目说明.md",
      kind: "file",
    });
    expect(pack?.requiredSkills).toEqual([]);
    expect(pack?.starterMessage).toContain("不强塞结构");
  });

  it("exposes the Short-Form web-fiction method pack contract", () => {
    const pack = getBuiltInMethodPack("short-form.article");

    expect(pack?.projectType).toBe("short-form");
    expect(pack?.storageProfile).toBe("short-form-compatible");
    expect(pack?.requiredPaths).not.toContainEqual({
      path: "目录说明.md",
      kind: "file",
    });
    expect(pack?.requiredPaths).toContainEqual({
      path: "简报.md",
      kind: "file",
    });
    expect(pack?.requiredPaths).toContainEqual({
      path: "大纲.md",
      kind: "file",
    });
    expect(pack?.requiredPaths).toContainEqual({
      path: "人物.md",
      kind: "file",
    });
    expect(pack?.requiredPaths).not.toContainEqual({
      path: "素材.md",
      kind: "file",
    });
    expect(pack?.requiredPaths).toContainEqual({
      path: "正文",
      kind: "directory",
    });
    expect(pack?.requiredPaths).toContainEqual({
      path: "自由区",
      kind: "directory",
    });
    expect(pack?.requiredPaths).not.toContainEqual({
      path: ".work",
      kind: "directory",
    });
    expect(pack?.requiredPaths).not.toContainEqual({
      path: "草稿",
      kind: "directory",
    });
    expect(pack?.requiredPaths).not.toContainEqual({
      path: "定稿",
      kind: "directory",
    });
    expect(pack?.requiredSkills).toEqual([
      "short-opening-designer",
      "short-golden-three",
      "short-draft-chapter",
      "short-reviser",
    ]);
    expect(pack?.agentIdentity).toBe("");
    expect(pack?.starterMessage).toContain("5,000-30,000");
    expect(pack?.starterMessage).not.toContain("5,000-40,000");
    expect(pack?.starterMessage).toContain("网文");
    expect(JSON.stringify(pack)).not.toContain("素材.md");
  });

  it("does not expose the removed Short Drama method pack", () => {
    expect(getBuiltInMethodPack("short-form.drama")).toBeNull();
  });

  it("does not expose retired Craft Agent writing method packs", () => {
    expect(getBuiltInMethodPack("novel.oh-story")).toBeNull();
    expect(getBuiltInMethodPack("novel.crucible")).toBeNull();
    expect(getBuiltInMethodPack("novel.creative-writing")).toBeNull();
  });

  it("uses localized and pack-specific starter messages", () => {
    const expectedKeywords: Record<string, string[]> = {
      "short-form.article": ["网文", "技能", "## 文件"],
      "novel.claude-book": ["项目圣经", "梗概", "章节计划"],
      "screenplay.logic": ["剧本", "分场", "对白"],
      "novel.free-creation": ["自由区", "正文", "不强塞结构"],
    };

    for (const pack of getBuiltInMethodPacks()) {
      expect(pack.starterMessage).toMatch(/[\u4e00-\u9fff]/);
      expect(pack.starterMessage).toStartWith("## 这是什么");
      if (pack.id === "short-form.article") {
        expect(pack.starterMessage).toContain("## 文件");
      } else {
        expect(pack.starterMessage).toContain("## 我会怎么做");
        expect(pack.starterMessage).toContain("## 流程");
        expect(pack.starterMessage).toContain("## 你现在可以提供");
      }
      expect(pack.starterMessage).not.toContain("I created");
      expect(pack.starterMessage).not.toContain("Start by");
      for (const keyword of expectedKeywords[pack.id] ?? []) {
        expect(pack.starterMessage).toContain(keyword);
      }
    }
  });

  it("returns null for unknown method packs", () => {
    expect(getBuiltInMethodPack("unknown")).toBeNull();
  });
});
