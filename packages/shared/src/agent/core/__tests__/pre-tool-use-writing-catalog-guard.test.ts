// input: Temporary writing workspaces with catalog-plus-free policy
// output: Assertions that Write/Edit outside catalog+free are blocked
// pos: Hard gate for user-authorized writing surface

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getWritingCatalogWriteBlock } from "../pre-tool-use.ts";

const roots: string[] = [];

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "craft-writing-catalog-guard-"));
  roots.push(root);
  return root;
}

function writeManifest(root: string, body: Record<string, unknown>): void {
  writeFileSync(join(root, "craft-writing.json"), JSON.stringify({
    schemaVersion: 1,
    type: "short-form",
    ...body,
  }));
}

describe("getWritingCatalogWriteBlock", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not block when writePolicy is missing (legacy)", () => {
    const root = makeTempRoot();
    writeManifest(root, {});

    expect(getWritingCatalogWriteBlock(
      "Write",
      { file_path: join(root, "正文/任意.md") },
      root,
      root,
    )).toBeNull();
  });

  it("allows catalog and free-root paths under catalog-plus-free", () => {
    const root = makeTempRoot();
    writeManifest(root, {
      catalog: { paths: ["全局/大纲.md"] },
      writePolicy: { mode: "catalog-plus-free", freeRoots: ["自由区", ".work"] },
    });

    expect(getWritingCatalogWriteBlock(
      "Edit",
      { file_path: join(root, "全局/大纲.md") },
      root,
      root,
    )).toBeNull();

    expect(getWritingCatalogWriteBlock(
      "Write",
      { file_path: join(root, "自由区/试写.md") },
      root,
      root,
    )).toBeNull();
  });

  it("blocks writes outside catalog and free roots", () => {
    const root = makeTempRoot();
    writeManifest(root, {
      catalog: { paths: ["全局/大纲.md"] },
      writePolicy: { mode: "catalog-plus-free", freeRoots: ["自由区"] },
    });

    const result = getWritingCatalogWriteBlock(
      "Write",
      { file_path: join(root, "正文/未经授权.md") },
      root,
      root,
    );

    expect(result?.message).toContain("user-authorized writing catalog");
    expect(result?.message).toContain("正文/未经授权.md");
  });

  it("blocks Bash redirects outside catalog and free roots", () => {
    const root = makeTempRoot();
    writeManifest(root, {
      catalog: { paths: ["全局/大纲.md"] },
      writePolicy: { mode: "catalog-plus-free", freeRoots: ["自由区"] },
    });

    const result = getWritingCatalogWriteBlock(
      "Bash",
      { command: "printf x > notes/data.json" },
      root,
      root,
    );

    expect(result?.message).toContain("notes/data.json");
  });

  it("allows one deterministic Bash redirect under a free root", () => {
    const root = makeTempRoot();
    writeManifest(root, {
      catalog: { paths: [] },
      writePolicy: { mode: "catalog-plus-free", freeRoots: ["自由区"] },
    });

    expect(getWritingCatalogWriteBlock(
      "Bash",
      { command: "printf x > 自由区/scratch.json" },
      root,
      root,
    )).toBeNull();
  });

  it("fails closed for opaque or multi-target Bash mutations", () => {
    const root = makeTempRoot();
    writeManifest(root, {
      catalog: { paths: [] },
      writePolicy: { mode: "catalog-plus-free", freeRoots: ["自由区"] },
    });

    for (const command of [
      "touch 自由区/scratch.json",
      "printf x > 自由区/a.json && printf y > notes/b.json",
    ]) {
      expect(getWritingCatalogWriteBlock("Bash", { command }, root, root)?.message)
        .toContain("unverified Bash write target");
    }
  });
});
