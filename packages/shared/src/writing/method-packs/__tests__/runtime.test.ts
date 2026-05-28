// input: Built-in Method Pack metadata
// output: Runtime prompt context assertions for Method Pack injection
// pos: Protects agent-facing runtime summaries and operating reminders

import { describe, expect, it } from "bun:test";
import { CLAUDE_BOOK_METHOD_PACK } from "../claude-book.ts";
import { getBuiltInMethodPack, getBuiltInMethodPacks } from "../index.ts";
import { buildMethodPackRuntimeContext, buildMethodPackRuntimePreamble } from "../runtime.ts";

describe("method pack runtime preamble", () => {
  it("summarizes the Claude-Book path contract", () => {
    const preamble = buildMethodPackRuntimePreamble(CLAUDE_BOOK_METHOD_PACK);

    expect(preamble).toContain("novel.claude-book");
    expect(preamble).toContain("bible/");
    expect(preamble).toContain("story/chapters/");
    expect(preamble).toContain("state/current/");
    expect(preamble).toContain("timeline/");
    expect(preamble).toContain(".work/");
    expect(preamble).toContain("temporary analysis");
  });

  it("builds legacy agent runtime context for non-profile method packs", () => {
    for (const pack of getBuiltInMethodPacks()) {
      if (pack.id === "short-form.article") continue;
      expect(pack.agentIdentity.length).toBeGreaterThan(20);
      expect(pack.alwaysOnInstructions.length).toBeGreaterThan(40);
      expect(pack.artifactContract.length).toBeGreaterThanOrEqual(4);

      const context = buildMethodPackRuntimeContext(pack);
      expect(context).toContain("<method_pack_runtime");
      expect(context).toContain(pack.id);
      expect(context).toContain(pack.agentIdentity);
      expect(context).toContain("Artifact Contract");
      expect(context).toContain("Skill Routing");
      expect(context).toContain("</method_pack_runtime>");
    }
  });

  it("requires every novel.* method pack to gate broad initial requests through a default skill", () => {
    for (const pack of getBuiltInMethodPacks()) {
      if (!pack.id.startsWith("novel.")) continue;
      expect(pack.defaultSkill).toBeTruthy();
      expect(pack.requiredSkills).toContain(pack.defaultSkill);
      expect(pack.initialRequestPolicy).toContain("Do not draft directly");
      expect(pack.skillRouting.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("treats short-form.article as a skill-backed work profile governed by file contract", () => {
    const pack = getBuiltInMethodPack("short-form.article");
    expect(pack).not.toBeNull();

    expect(pack?.requiredSkills).toEqual([
      "short-opening-designer",
      "short-golden-three",
      "short-draft-chapter",
      "short-reviser",
    ]);
    expect(pack?.skillRouting).toEqual([]);
    expect(pack?.defaultSkill).toBe("");
  });

  it("keeps short-form profile free of agent-facing writing methods", () => {
    const pack = getBuiltInMethodPack("short-form.article");
    expect(pack).not.toBeNull();

    const serialized = JSON.stringify(pack);

    expect(pack?.requiredPaths).not.toContainEqual({ path: "目录说明.md", kind: "file" });
    expect(pack?.requiredPaths).toContainEqual({ path: "简报.md", kind: "file" });
    expect(pack?.requiredPaths).not.toContainEqual({ path: "黄金三章.md", kind: "file" });
    expect(pack?.requiredPaths).toContainEqual({ path: "大纲.md", kind: "file" });
    expect(pack?.requiredPaths).toContainEqual({ path: "人物.md", kind: "file" });
    expect(pack?.requiredPaths).not.toContainEqual({ path: "素材.md", kind: "file" });
    expect(pack?.requiredPaths).toContainEqual({ path: "正文", kind: "directory" });
    expect(pack?.requiredPaths).toContainEqual({ path: "自由区", kind: "directory" });
    expect(pack?.requiredPaths).not.toContainEqual({ path: ".work", kind: "directory" });
    expect(serialized).not.toContain("素材.md");
    expect(serialized).not.toContain("首章入场坡道");
    expect(serialized).not.toContain("原创题记");
    expect(serialized).not.toContain("前三段");
    expect(serialized).not.toContain("高压开场");
    expect(serialized).not.toContain("情绪账本");
    expect(pack?.requiredSkills).toContain("short-opening-designer");
    expect(pack?.requiredSkills).toContain("short-draft-chapter");
  });
});
