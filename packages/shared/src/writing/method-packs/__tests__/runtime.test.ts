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
  });

  it("builds an always-on agent runtime context for every built-in method pack", () => {
    for (const pack of getBuiltInMethodPacks()) {
      expect(pack.agentIdentity.length).toBeGreaterThan(20);
      expect(pack.alwaysOnInstructions.length).toBeGreaterThan(40);
      expect(pack.defaultSkill).toBeTruthy();
      expect(pack.requiredSkills).toContain(pack.defaultSkill);
      expect(pack.initialRequestPolicy).toContain("Do not draft directly");
      expect(pack.artifactContract.length).toBeGreaterThanOrEqual(4);
      expect(pack.skillRouting.length).toBeGreaterThanOrEqual(3);

      const context = buildMethodPackRuntimeContext(pack);
      expect(context).toContain("<method_pack_runtime");
      expect(context).toContain(pack.id);
      expect(context).toContain(pack.agentIdentity);
      expect(context).toContain(pack.defaultSkill);
      expect(context).toContain("Artifact Contract");
      expect(context).toContain("Skill Routing");
      expect(context).toContain("</method_pack_runtime>");
    }
  });

  it("includes explicit short-form file placement and naming rules", () => {
    const pack = getBuiltInMethodPack("short-form.article");
    expect(pack).not.toBeNull();

    const context = buildMethodPackRuntimeContext(pack!);

    expect(pack?.requiredPaths).toContainEqual({ path: "目录说明.md", kind: "file" });
    expect(context).toContain("目录说明.md");
    expect(context).toContain("Naming Conventions");
    expect(context).toContain("短文简报.md");
    expect(context).toContain("素材卡.md");
    expect(context).toContain("草稿/");
    expect(context).toContain("YYYYMMDD-topic-vNN.md");
    expect(context).toContain("定稿/");
    expect(context).toContain("YYYYMMDD-topic-final.md");
    expect(context).not.toContain("修订/");
    expect(context).not.toContain("评审/");
  });
});
