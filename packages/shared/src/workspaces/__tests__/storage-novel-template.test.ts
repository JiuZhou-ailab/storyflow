import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createNovelWorkspaceAtPath } from "../storage.ts";

describe("createNovelWorkspaceAtPath", () => {
  it("creates a normal workspace with a novel scaffold", () => {
    const rootPath = mkdtempSync(join(tmpdir(), "craft-novel-workspace-"));

    const config = createNovelWorkspaceAtPath(rootPath, "Novel Workspace");

    expect(config.name).toBe("Novel Workspace");
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
});
