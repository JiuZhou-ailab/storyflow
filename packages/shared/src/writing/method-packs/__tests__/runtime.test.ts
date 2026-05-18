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

  it("treats short-form.article as a skill-free method pack governed entirely by file contract", () => {
    const pack = getBuiltInMethodPack("short-form.article");
    expect(pack).not.toBeNull();

    expect(pack?.requiredSkills).toEqual([]);
    expect(pack?.skillRouting).toEqual([]);
    expect(pack?.defaultSkill).toBe("");
    expect(pack?.initialRequestPolicy).toContain("正文/");
  });

  it("includes explicit short-form web-fiction file placement and naming rules", () => {
    const pack = getBuiltInMethodPack("short-form.article");
    expect(pack).not.toBeNull();

    const context = buildMethodPackRuntimeContext(pack!);

    expect(pack?.requiredPaths).toContainEqual({ path: "目录说明.md", kind: "file" });
    expect(pack?.requiredPaths).toContainEqual({ path: "简报.md", kind: "file" });
    expect(pack?.requiredPaths).toContainEqual({ path: "大纲.md", kind: "file" });
    expect(pack?.requiredPaths).toContainEqual({ path: "人物.md", kind: "file" });
    expect(pack?.requiredPaths).toContainEqual({ path: "素材.md", kind: "file" });
    expect(pack?.requiredPaths).toContainEqual({ path: "正文", kind: "directory" });
    expect(context).toContain("目录说明.md");
    expect(context).toContain("Naming Conventions");
    expect(context).toContain("正文/");
    expect(context).toContain("NN-标题.md");
    expect(context).not.toContain("YYYYMMDD-topic-vNN.md");
    expect(context).not.toContain("YYYYMMDD-topic-final.md");
  });

  it("renders short-form operating rules with always and periodic reminders", () => {
    const pack = getBuiltInMethodPack("short-form.article");
    expect(pack).not.toBeNull();

    const context = buildMethodPackRuntimeContext(pack!);

    expect(pack?.operatingRules).toEqual({
      always: [
        "默认一次只写当前下一章，注意前后衔接，除非用户明确要求不遵循。",
        "简报.md 与 大纲.md 未完成前不要写入 正文/。",
      ],
      periodic: {
        intervalTurns: 2,
        rules: [
          "连续正文写作时，快速核对 创作要求.md / 简报.md / 大纲.md / 人物.md 中与当前章节相关的约束，避免人物、钩子和节奏漂移。",
          "修订直接覆盖同一章节文件，用 git diff 留痕。",
          "实验、废弃版本、审校笔记放 .work/。",
          "人物动机、设定、素材冲突时，优先回到 简报.md / 人物.md / 素材.md 修正。",
        ],
      },
    });
    expect(context).toContain("## Operating Rules");
    expect(context).toContain("### Always");
    expect(context).toContain("默认一次只写当前下一章");
    expect(context).toContain("简报.md 与 大纲.md 未完成前不要写入 正文/");
    expect(context).toContain("Interval: every 2 user messages.");
    expect(context).toContain("快速核对 创作要求.md / 简报.md / 大纲.md / 人物.md");
    expect(context).toContain("修订直接覆盖同一章节文件，用 git diff 留痕。");
  });
});
