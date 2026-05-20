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

    expect(pack?.requiredPaths).not.toContainEqual({ path: "目录说明.md", kind: "file" });
    expect(pack?.requiredPaths).toContainEqual({ path: "简报.md", kind: "file" });
    expect(pack?.requiredPaths).not.toContainEqual({ path: "黄金三章.md", kind: "file" });
    expect(pack?.requiredPaths).toContainEqual({ path: "大纲.md", kind: "file" });
    expect(pack?.requiredPaths).toContainEqual({ path: "人物.md", kind: "file" });
    expect(pack?.requiredPaths).toContainEqual({ path: "素材.md", kind: "file" });
    expect(pack?.requiredPaths).toContainEqual({ path: "正文", kind: "directory" });
    expect(pack?.requiredPaths).toContainEqual({ path: "自由区", kind: "directory" });
    expect(pack?.requiredPaths).not.toContainEqual({ path: ".work", kind: "directory" });
    expect(context).not.toContain("目录说明.md");
    expect(context).not.toContain("黄金三章.md");
    expect(context).toContain("简报.md");
    expect(context).toContain("黄金三章");
    expect(context).toContain("前三章留存设计");
    expect(context).toContain("第 1 章拉新");
    expect(context).toContain("第 2 章加压");
    expect(context).toContain("第 3 章锁留存");
    expect(context).toContain("小说密度");
    expect(context).toContain("事件密度");
    expect(context).toContain("情绪调动程度");
    expect(context).toContain("高压开场");
    expect(context).toContain("连续阻断");
    expect(context).toContain("即时兑现");
    expect(context).toContain("场景可视化");
    expect(context).toContain("情绪账本");
    expect(context).toContain("章尾强悬念");
    expect(context).toContain("Naming Conventions");
    expect(context).toContain("正文/");
    expect(context).toContain("NN-标题.md");
    expect(context).toContain("正文/ 可以按卷、篇或阶段建立子目录");
    expect(context).toContain("自由区/ 可以自由创建文件和文件夹");
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
        "简报.md 与 大纲.md 未完成前不要写入 正文/；简报必须包含黄金三章、小说密度、事件密度和情绪调动程度选择。",
      ],
      periodic: {
        intervalTurns: 2,
        rules: [
          "连续正文写作时，快速核对 创作要求.md / 简报.md / 大纲.md / 人物.md 中与当前章节相关的约束，避免人物、钩子、密度和情绪节奏漂移。",
          "检查当前章节是否具备高压开场、连续阻断、即时兑现、场景可视化、情绪账本和章尾强悬念；缺一项时先补结构再润色。",
          "修订直接覆盖同一章节文件，用 git diff 留痕。",
          "实验、废弃版本、审校笔记放 自由区/。",
          "人物动机、设定、素材冲突时，优先回到 简报.md / 人物.md / 素材.md 修正。",
        ],
      },
    });
    expect(context).toContain("## Operating Rules");
    expect(context).toContain("### Always");
    expect(context).toContain("默认一次只写当前下一章");
    expect(context).toContain("简报.md 与 大纲.md 未完成前不要写入 正文/");
    expect(context).toContain("简报必须包含黄金三章、小说密度、事件密度和情绪调动程度选择");
    expect(context).toContain("Interval: every 2 user messages.");
    expect(context).toContain("快速核对 创作要求.md / 简报.md / 大纲.md / 人物.md");
    expect(context).toContain("密度和情绪节奏漂移");
    expect(context).toContain("缺一项时先补结构再润色");
    expect(context).toContain("修订直接覆盖同一章节文件，用 git diff 留痕。");
  });
});
