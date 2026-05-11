import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createNovelProjectScaffold } from "../../writing/novel-template.ts";
import { createNovelWorkspaceAtPath, createWorkspaceAtPath, loadWorkspaceConfig, saveWorkspaceConfig } from "../storage.ts";

describe("createNovelWorkspaceAtPath", () => {
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

  it("creates a starter chat session for the selected method pack", () => {
    const rootPath = mkdtempSync(join(tmpdir(), "craft-novel-oh-story-session-"));

    createNovelWorkspaceAtPath(rootPath, "Web Fiction", undefined, "novel.oh-story");

    const sessionIds = readdirSync(join(rootPath, "sessions"));
    const sessionContent = readFileSync(join(rootPath, "sessions", sessionIds[0]!, "session.jsonl"), "utf-8");
    expect(sessionContent).toContain("novel.oh-story");
    expect(sessionContent).toContain("web-fiction");
  });
});
