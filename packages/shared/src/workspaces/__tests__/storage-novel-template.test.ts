// input: Workspace storage creation helpers and built-in novel Method Packs
// output: Regression tests for novel workspace scaffolding and starter session creation
// pos: Shared storage guard for Method Pack-backed workspace creation

import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createNovelProjectScaffold } from "../../writing/novel-template.ts";
import { getBuiltInMethodPacks } from "../../writing/method-packs/index.ts";
import { createNovelWorkspaceAtPath, createWorkspaceAtPath, generateSlug, loadWorkspaceConfig, saveWorkspaceConfig } from "../storage.ts";

describe("createNovelWorkspaceAtPath", () => {
  it("generates a stable non-empty slug for non-ASCII workspace names", () => {
    expect(generateSlug("九州小说")).toMatch(/^workspace-[a-z0-9]+$/);
  });

  it("creates a normal workspace with a novel scaffold", () => {
    const rootPath = mkdtempSync(join(tmpdir(), "craft-novel-workspace-"));

    const config = createNovelWorkspaceAtPath(rootPath, "Novel Workspace");

    expect(config.name).toBe("Novel Workspace");
    expect(config.defaults?.workingDirectory).toBe(rootPath);
    expect(existsSync(join(rootPath, "config.json"))).toBe(true);
    expect(existsSync(join(rootPath, "sources"))).toBe(true);
    expect(existsSync(join(rootPath, "sessions"))).toBe(true);
    expect(existsSync(join(rootPath, "skills"))).toBe(true);
    expect(existsSync(join(rootPath, "craft-writing.json"))).toBe(true);
    expect(existsSync(join(rootPath, "bible", "style.md"))).toBe(true);

    const manifest = JSON.parse(readFileSync(join(rootPath, "craft-writing.json"), "utf-8"));
    expect(manifest.type).toBe("novel");
    expect(manifest.title).toBe("Novel Workspace");
  });

  it("migrates existing novel workspace configs to use the workspace root as the default working directory", () => {
    const rootPath = mkdtempSync(join(tmpdir(), "craft-existing-novel-workspace-"));
    const config = createWorkspaceAtPath(rootPath, "Existing Novel Workspace");
    createNovelProjectScaffold(rootPath, { title: "Existing Novel Workspace" });
    saveWorkspaceConfig(rootPath, {
      ...config,
      defaults: {
        ...config.defaults,
        workingDirectory: undefined,
      },
    });

    expect(loadWorkspaceConfig(rootPath)?.defaults?.workingDirectory).toBe(rootPath);
  });

  it("fills missing scaffold files when loading an existing novel workspace", () => {
    const rootPath = mkdtempSync(join(tmpdir(), "craft-existing-novel-scaffold-"));
    createWorkspaceAtPath(rootPath, "Existing Novel Workspace");
    createNovelProjectScaffold(rootPath, { title: "Existing Novel Workspace" });

    rmSync(join(rootPath, "story", "chapters", "chapter-01.md"), { force: true });

    expect(loadWorkspaceConfig(rootPath)).not.toBeNull();
    expect(existsSync(join(rootPath, "story", "chapters", "chapter-01.md"))).toBe(true);
  });

  it("repairs existing novel workspaces using the manifest method pack", () => {
    const rootPath = mkdtempSync(join(tmpdir(), "craft-existing-oh-story-scaffold-"));
    createWorkspaceAtPath(rootPath, "Existing Web Fiction Workspace");
    createNovelProjectScaffold(rootPath, {
      title: "Existing Web Fiction Workspace",
      methodPackId: "novel.oh-story",
    });

    rmSync(join(rootPath, "大纲", "大纲.md"), { force: true });

    expect(loadWorkspaceConfig(rootPath)).not.toBeNull();
    expect(existsSync(join(rootPath, "大纲", "大纲.md"))).toBe(true);
    expect(existsSync(join(rootPath, "bible", "style.md"))).toBe(false);
  });

  it("creates a starter chat session for a new novel workspace", () => {
    const rootPath = mkdtempSync(join(tmpdir(), "craft-novel-starter-session-"));

    createNovelWorkspaceAtPath(rootPath, "Starter Novel");

    const sessionIds = readdirSync(join(rootPath, "sessions"));
    expect(sessionIds).toHaveLength(1);

    const sessionContent = readFileSync(join(rootPath, "sessions", sessionIds[0]!, "session.jsonl"), "utf-8");
    expect(sessionContent).toContain('"name":"Start writing"');
    expect(sessionContent).toContain('"type":"assistant"');
    expect(sessionContent).toContain("Claude-Book");
  });

  it("creates a starter chat session for each selected method pack", () => {
    for (const methodPack of getBuiltInMethodPacks()) {
      const rootPath = mkdtempSync(join(tmpdir(), "craft-novel-method-session-"));

      createNovelWorkspaceAtPath(rootPath, methodPack.displayName, undefined, methodPack.id);

      const sessionIds = readdirSync(join(rootPath, "sessions"));
      const sessionContent = readFileSync(join(rootPath, "sessions", sessionIds[0]!, "session.jsonl"), "utf-8");
      const starterMessage = JSON.parse(sessionContent.trim().split(/\r?\n/)[1] ?? "{}") as { content?: string };
      expect(sessionContent).toContain(methodPack.id);
      expect(starterMessage.content).toContain(methodPack.starterMessage);
    }
  });

  it("writes a localized short-form starter chat session", () => {
    const rootPath = mkdtempSync(join(tmpdir(), "craft-short-form-starter-session-"));

    createNovelWorkspaceAtPath(rootPath, "Short Starter", undefined, "short-form.article");

    const sessionIds = readdirSync(join(rootPath, "sessions"));
    const sessionContent = readFileSync(join(rootPath, "sessions", sessionIds[0]!, "session.jsonl"), "utf-8");
    expect(sessionContent).toContain("## 这是什么");
    expect(sessionContent).toContain("## 我会怎么做");
    expect(sessionContent).toContain("## 流程");
    expect(sessionContent).toContain("## 你现在可以提供");
    expect(sessionContent).toContain("短文写作工作区");
    expect(sessionContent).toContain("目标读者");
    expect(sessionContent).toContain("Method Pack: short-form.article");
    expect(sessionContent).not.toContain("I created a short-form writing workspace");
  });

  it("repairs stale generated starter sessions for every built-in method pack", () => {
    for (const methodPack of getBuiltInMethodPacks()) {
      const rootPath = mkdtempSync(join(tmpdir(), "craft-stale-method-starter-session-"));

      createNovelWorkspaceAtPath(rootPath, methodPack.displayName, undefined, methodPack.id);

      const sessionIds = readdirSync(join(rootPath, "sessions"));
      const sessionPath = join(rootPath, "sessions", sessionIds[0]!, "session.jsonl");
      const lines = readFileSync(sessionPath, "utf-8").trim().split(/\r?\n/);
      const staleMessage = {
        ...JSON.parse(lines[1] ?? "{}"),
        content: `I created a short-form writing workspace. Start by sharing the target reader, platform, intended length, central claim or reader promise, source material, examples you like, and whether the first piece should be an essay, newsletter, social post, blog article, memo, or opinion piece.\n\nMethod Pack: ${methodPack.id}`,
      };
      writeFileSync(sessionPath, `${lines[0]}\n${JSON.stringify(staleMessage)}\n`, "utf-8");

      expect(loadWorkspaceConfig(rootPath)).not.toBeNull();

      const repairedContent = readFileSync(sessionPath, "utf-8");
      const repairedMessage = JSON.parse(repairedContent.trim().split(/\r?\n/)[1] ?? "{}") as { content?: string };
      expect(repairedMessage.content).toContain(methodPack.starterMessage);
      expect(repairedMessage.content).toContain(`Method Pack: ${methodPack.id}`);
      expect(repairedMessage.content).not.toContain("I created a short-form writing workspace");
      expect(repairedMessage.content).not.toContain("Start by sharing");
    }
  });
});
