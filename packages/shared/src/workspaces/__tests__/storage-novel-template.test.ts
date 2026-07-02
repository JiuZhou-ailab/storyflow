// input: Workspace storage creation helpers and built-in novel Method Packs
// output: Regression tests for novel workspace scaffolding and starter session creation
// pos: Shared storage guard for Method Pack-backed workspace creation

import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createNovelProjectScaffold } from "../../writing/novel-template.ts";
import { getBuiltInMethodPacks } from "../../writing/method-packs/index.ts";
import { createDefaultWorkspaceAtPath, createNovelWorkspaceAtPath, createWorkspaceAtPath, generateSlug, loadWorkspaceConfig, saveWorkspaceConfig } from "../storage.ts";

function statePath(rootPath: string, relativePath = ""): string {
  return join(rootPath, ".craft-agent", relativePath);
}

describe("createNovelWorkspaceAtPath", () => {
  it("creates the product default workspace as a short-form novel workspace", () => {
    const rootPath = mkdtempSync(join(tmpdir(), "craft-default-workspace-"));

    const config = createDefaultWorkspaceAtPath(rootPath);

    expect(config.name).toBe("短篇/中篇小说");
    expect(config.defaults?.workingDirectory).toBe(rootPath);
    expect(existsSync(join(rootPath, "正文"))).toBe(true);
    expect(existsSync(join(rootPath, "全局", "简报.md"))).toBe(true);
    expect(existsSync(join(rootPath, "自由区"))).toBe(true);
    expect(existsSync(join(rootPath, "README.md"))).toBe(false);
    expect(existsSync(statePath(rootPath, "README.md"))).toBe(true);

    const manifest = JSON.parse(readFileSync(statePath(rootPath, "craft-writing.json"), "utf-8"));
    expect(manifest.type).toBe("short-form");
    expect(manifest.methodPack.id).toBe("short-form.article");
  });

  it("generates a stable non-empty slug for non-ASCII workspace names", () => {
    expect(generateSlug("九州小说")).toMatch(/^workspace-[a-z0-9]+$/);
  });

  it("creates a normal workspace with the default short-form scaffold", () => {
    const rootPath = mkdtempSync(join(tmpdir(), "craft-novel-workspace-"));

    const config = createNovelWorkspaceAtPath(rootPath, "Novel Workspace");

    expect(config.name).toBe("Novel Workspace");
    expect(config.defaults?.workingDirectory).toBe(rootPath);
    expect(existsSync(join(rootPath, "config.json"))).toBe(false);
    expect(existsSync(join(rootPath, "sources"))).toBe(false);
    expect(existsSync(join(rootPath, "sessions"))).toBe(false);
    expect(existsSync(join(rootPath, "skills"))).toBe(false);
    expect(existsSync(join(rootPath, "craft-writing.json"))).toBe(false);
    expect(existsSync(statePath(rootPath, "config.json"))).toBe(true);
    expect(existsSync(statePath(rootPath, "sources"))).toBe(true);
    expect(existsSync(statePath(rootPath, "sessions"))).toBe(true);
    expect(existsSync(statePath(rootPath, "skills"))).toBe(true);
    expect(existsSync(statePath(rootPath, "craft-writing.json"))).toBe(true);
    expect(existsSync(join(rootPath, "正文"))).toBe(true);
    expect(existsSync(join(rootPath, "全局", "简报.md"))).toBe(true);
    expect(existsSync(join(rootPath, "自由区"))).toBe(true);

    const manifest = JSON.parse(readFileSync(statePath(rootPath, "craft-writing.json"), "utf-8"));
    expect(manifest.type).toBe("short-form");
    expect(manifest.title).toBe("Novel Workspace");
    expect(manifest.methodPack.id).toBe("short-form.article");
  });

  it("migrates legacy generated workspace state under .craft-agent without moving project content", () => {
    const rootPath = mkdtempSync(join(tmpdir(), "craft-legacy-state-workspace-"));
    const now = Date.now();

    mkdirSync(join(rootPath, "sessions", "260703-legacy"), { recursive: true });
    mkdirSync(join(rootPath, "skills", "short-reviser"), { recursive: true });
    mkdirSync(join(rootPath, "labels"), { recursive: true });
    mkdirSync(join(rootPath, "statuses", "icons"), { recursive: true });
    mkdirSync(join(rootPath, ".claude-plugin"), { recursive: true });
    mkdirSync(join(rootPath, "全局"), { recursive: true });
    mkdirSync(statePath(rootPath, "sessions/260703-current"), { recursive: true });

    writeFileSync(join(rootPath, "config.json"), JSON.stringify({
      id: "ws_legacy",
      name: "Legacy Short",
      slug: "legacy-short",
      defaults: {},
      createdAt: now,
      updatedAt: now,
    }, null, 2));
    writeFileSync(join(rootPath, "craft-writing.json"), JSON.stringify({
      schemaVersion: 1,
      type: "short-form",
      title: "Legacy Short",
      methodPack: { id: "short-form.article", version: 1 },
    }, null, 2));
    writeFileSync(join(rootPath, "craft-pack-lock.json"), "{}\n");
    writeFileSync(join(rootPath, "AGENTS.md"), "# Agent\n");
    writeFileSync(join(rootPath, "CLAUDE.md"), "# Claude\n");
    writeFileSync(join(rootPath, "NOTICE-Short-Form-Writing.md"), "# Notice\n");
    writeFileSync(join(rootPath, "README.md"), "# Root readme\n");
    writeFileSync(join(rootPath, "views.json"), "{\"version\":1,\"views\":[]}\n");
    writeFileSync(join(rootPath, "labels", "config.json"), "{\"version\":1,\"labels\":[]}\n");
    writeFileSync(join(rootPath, "statuses", "config.json"), "{\"version\":1,\"statuses\":[],\"defaultStatusId\":\"todo\"}\n");
    writeFileSync(join(rootPath, "statuses", "icons", "todo.svg"), "<svg />\n");
    writeFileSync(join(rootPath, "sessions", "260703-legacy", "session.jsonl"), "{}\n");
    writeFileSync(statePath(rootPath, "sessions/260703-current/session.jsonl"), "{}\n");
    writeFileSync(join(rootPath, "skills", "short-reviser", "SKILL.md"), "# Skill\n");
    writeFileSync(join(rootPath, ".claude-plugin", "plugin.json"), "{\"name\":\"craft-workspace-legacy\"}\n");
    writeFileSync(join(rootPath, "全局", "简报.md"), "# 简报\n");

    const config = loadWorkspaceConfig(rootPath);

    expect(config?.name).toBe("Legacy Short");
    expect(existsSync(join(rootPath, "config.json"))).toBe(false);
    expect(existsSync(join(rootPath, "craft-writing.json"))).toBe(false);
    expect(existsSync(join(rootPath, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(rootPath, "sessions"))).toBe(false);
    expect(existsSync(join(rootPath, "skills"))).toBe(false);
    expect(existsSync(join(rootPath, ".claude-plugin"))).toBe(false);
    expect(existsSync(statePath(rootPath, "config.json"))).toBe(true);
    expect(existsSync(statePath(rootPath, "craft-writing.json"))).toBe(true);
    expect(existsSync(statePath(rootPath, "AGENTS.md"))).toBe(true);
    expect(existsSync(statePath(rootPath, "sessions/260703-legacy/session.jsonl"))).toBe(true);
    expect(existsSync(statePath(rootPath, "sessions/260703-current/session.jsonl"))).toBe(true);
    expect(existsSync(statePath(rootPath, "legacy-root/sessions"))).toBe(false);
    expect(existsSync(statePath(rootPath, "skills/short-reviser/SKILL.md"))).toBe(true);
    expect(existsSync(statePath(rootPath, "claude-plugin/plugin.json"))).toBe(true);
    expect(existsSync(join(rootPath, "全局", "简报.md"))).toBe(true);
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
    const rootPath = mkdtempSync(join(tmpdir(), "craft-existing-screenplay-scaffold-"));
    createWorkspaceAtPath(rootPath, "Existing Screenplay Workspace");
    createNovelProjectScaffold(rootPath, {
      title: "Existing Screenplay Workspace",
      methodPackId: "screenplay.logic",
    });

    rmSync(join(rootPath, "剧本", "分场大纲.md"), { force: true });

    expect(loadWorkspaceConfig(rootPath)).not.toBeNull();
    expect(existsSync(join(rootPath, "剧本", "分场大纲.md"))).toBe(true);
    expect(existsSync(join(rootPath, "bible", "style.md"))).toBe(false);
  });

  it("creates a starter chat session for a new novel workspace", () => {
    const rootPath = mkdtempSync(join(tmpdir(), "craft-novel-starter-session-"));

    createNovelWorkspaceAtPath(rootPath, "Starter Novel");

    const sessionIds = readdirSync(statePath(rootPath, "sessions"));
    expect(sessionIds).toHaveLength(1);

    const sessionContent = readFileSync(statePath(rootPath, join("sessions", sessionIds[0]!, "session.jsonl")), "utf-8");
    expect(sessionContent).toContain('"name":"Start writing"');
    expect(sessionContent).toContain('"type":"assistant"');
    expect(sessionContent).toContain("Method Pack: short-form.article");
    expect(sessionContent).toContain("中文短篇/中篇网文");
  });

  it("creates a starter chat session for each selected method pack", () => {
    for (const methodPack of getBuiltInMethodPacks()) {
      const rootPath = mkdtempSync(join(tmpdir(), "craft-novel-method-session-"));

      createNovelWorkspaceAtPath(rootPath, methodPack.displayName, undefined, methodPack.id);

      const sessionIds = readdirSync(statePath(rootPath, "sessions"));
      const sessionContent = readFileSync(statePath(rootPath, join("sessions", sessionIds[0]!, "session.jsonl")), "utf-8");
      const starterMessage = JSON.parse(sessionContent.trim().split(/\r?\n/)[1] ?? "{}") as { content?: string };
      expect(sessionContent).toContain(methodPack.id);
      expect(starterMessage.content).toContain(methodPack.starterMessage);
    }
  });

  it("writes a localized short-form starter chat session", () => {
    const rootPath = mkdtempSync(join(tmpdir(), "craft-short-form-starter-session-"));

    createNovelWorkspaceAtPath(rootPath, "Short Starter", undefined, "short-form.article");

    const sessionIds = readdirSync(statePath(rootPath, "sessions"));
    const sessionContent = readFileSync(statePath(rootPath, join("sessions", sessionIds[0]!, "session.jsonl")), "utf-8");
    expect(sessionContent).toContain("## 这是什么");
    expect(sessionContent).toContain("## 我会怎么做");
    expect(sessionContent).toContain("## 流程");
    expect(sessionContent).toContain("## 你现在可以提供");
    expect(sessionContent).toContain("中文短篇/中篇网文");
    expect(sessionContent).toContain("钩子");
    expect(sessionContent).toContain("Method Pack: short-form.article");
    expect(sessionContent).not.toContain("I created a short-form writing workspace");
  });

  it("repairs stale generated starter sessions for every built-in method pack", () => {
    for (const methodPack of getBuiltInMethodPacks()) {
      const rootPath = mkdtempSync(join(tmpdir(), "craft-stale-method-starter-session-"));

      createNovelWorkspaceAtPath(rootPath, methodPack.displayName, undefined, methodPack.id);

      const sessionIds = readdirSync(statePath(rootPath, "sessions"));
      const sessionPath = statePath(rootPath, join("sessions", sessionIds[0]!, "session.jsonl"));
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
