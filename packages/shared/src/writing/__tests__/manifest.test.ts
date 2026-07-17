import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { detectManifestWritingProject, detectWritingProject } from "../manifest.ts";

function createTempProject(): string {
  return mkdtempSync(join(tmpdir(), "craft-writing-"));
}

function writeStateManifest(rootPath: string, manifest: Record<string, unknown> | string): void {
  mkdirSync(join(rootPath, ".craft-agent"), { recursive: true });
  writeFileSync(
    join(rootPath, ".craft-agent", "craft-writing.json"),
    typeof manifest === "string" ? manifest : JSON.stringify(manifest),
  );
}

describe("detectWritingProject", () => {
  it("returns null when no writing manifest or structure exists", () => {
    expect(detectWritingProject(createTempProject())).toBeNull();
  });

  it("loads a valid novel manifest", () => {
    const rootPath = createTempProject();
    writeStateManifest(rootPath, {
      schemaVersion: 1,
      type: "novel",
      language: "zh-Hans",
      title: "Test Novel",
      methodPack: {
        id: "novel.claude-book",
        version: 1,
      },
      storageProfile: "claude-book-compatible",
      catalog: { paths: ["story/plan.md", "bible/structure.md"] },
      writePolicy: { mode: "catalog-plus-free", freeRoots: [".work"] },
    });

    const project = detectWritingProject(rootPath);

    expect(project?.type).toBe("novel");
    expect(project?.source).toBe("manifest");
    expect(project?.manifest.title).toBe("Test Novel");
    expect(project?.manifest.methodPack).toEqual({
      id: "novel.claude-book",
      version: 1,
    });
    expect(project?.manifest.storageProfile).toBe("claude-book-compatible");
    expect(project?.manifest.catalog).toEqual({
      paths: ["bible/structure.md", "story/plan.md"],
    });
    expect(project?.manifest.writePolicy).toEqual({
      mode: "catalog-plus-free",
      freeRoots: [".work"],
    });
    expect(project?.directories.bible).toBe(join(rootPath, "bible"));
  });

  it("keeps reading legacy root manifests", () => {
    const rootPath = createTempProject();
    writeFileSync(join(rootPath, "craft-writing.json"), JSON.stringify({
      schemaVersion: 1,
      type: "short-form",
      title: "Legacy Short",
    }));

    const project = detectWritingProject(rootPath);

    expect(project?.type).toBe("short-form");
    expect(project?.source).toBe("manifest");
    expect(project?.manifest.title).toBe("Legacy Short");
  });

  it("detects Claude-Book-compatible novel structure without a manifest", () => {
    const rootPath = createTempProject();
    for (const dir of ["bible", "story", "state", "timeline"]) {
      mkdirSync(join(rootPath, dir), { recursive: true });
    }

    const project = detectWritingProject(rootPath);

    expect(project?.type).toBe("novel");
    expect(project?.source).toBe("structure");
    expect(project?.manifest.schemaVersion).toBe(1);
  });

  it("keeps manifest-only detection from accepting directory structure", () => {
    const rootPath = createTempProject();
    for (const dir of ["bible", "story", "state", "timeline"]) {
      mkdirSync(join(rootPath, dir), { recursive: true });
    }

    expect(detectManifestWritingProject(rootPath)).toBeNull();
  });

  it("returns null for an unsupported manifest type", () => {
    const rootPath = createTempProject();
    writeStateManifest(rootPath, {
      schemaVersion: 1,
      type: "poetry",
    });

    expect(detectWritingProject(rootPath)).toBeNull();
  });

  it("returns null for a malformed manifest", () => {
    const rootPath = createTempProject();
    writeStateManifest(rootPath, "{not-json");

    expect(detectWritingProject(rootPath)).toBeNull();
  });
});
