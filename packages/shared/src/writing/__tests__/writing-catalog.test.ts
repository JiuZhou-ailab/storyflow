// input: Catalog and write-policy fixtures
// output: Assertions for authorize/filter/seed helpers
// pos: Protects user-authorized writing surface constraints

import { describe, expect, it } from "bun:test";
import {
  filterFilesByWritingCatalog,
  isWritingCatalogPath,
  isWritingCatalogVisiblePath,
  isWritingWriteAllowed,
  normalizeWritingCatalog,
  parseWritingCatalogConfig,
  seedCatalogPathsFromRequiredPaths,
  withWritingCatalogPath,
} from "../writing-catalog.ts";

describe("writing-catalog", () => {
  it("seeds catalog from required file paths only", () => {
    const paths = seedCatalogPathsFromRequiredPaths([
      { path: "craft-writing.json", kind: "file" },
      { path: "正文", kind: "directory" },
      { path: "全局/大纲.md", kind: "file" },
      { path: "全局/人物.md", kind: "file" },
    ]);
    expect(paths).toHaveLength(2);
    expect(paths).toContain("全局/大纲.md");
    expect(paths).toContain("全局/人物.md");
    expect(paths).not.toContain("craft-writing.json");
    expect(paths).not.toContain("正文");
  });

  it("allows all writes in legacy mode", () => {
    expect(isWritingWriteAllowed("正文/01.md", { paths: [] }, { mode: "legacy" })).toBe(true);
    expect(isWritingWriteAllowed("正文/01.md", undefined, undefined)).toBe(true);
  });

  it("enforces catalog-plus-free write scope", () => {
    const catalog = { paths: ["全局/大纲.md", "正文/01.md"] };
    const policy = { mode: "catalog-plus-free" as const, freeRoots: ["自由区", ".work"] };

    expect(isWritingWriteAllowed("全局/大纲.md", catalog, policy, "short-form")).toBe(true);
    expect(isWritingWriteAllowed("自由区/试写.md", catalog, policy, "short-form")).toBe(true);
    expect(isWritingWriteAllowed(".work/scratch.md", catalog, policy, "short-form")).toBe(true);
    expect(isWritingWriteAllowed("正文/02.md", catalog, policy, "short-form")).toBe(false);
    expect(isWritingWriteAllowed("sessions/x/session.jsonl", catalog, policy, "short-form")).toBe(false);
  });

  it("filters sidebar files to catalog only under catalog-plus-free", () => {
    const files = [
      { relativePath: "全局/大纲.md" },
      { relativePath: "正文/01.md" },
      { relativePath: "自由区/试写.md" },
      { relativePath: "正文/02.md" },
    ];
    const catalog = { paths: ["全局/大纲.md", "正文/01.md"] };
    const policy = { mode: "catalog-plus-free" as const, freeRoots: ["自由区"] };

    expect(filterFilesByWritingCatalog(files, catalog, policy, "short-form").map((f) => f.relativePath))
      .toEqual(["全局/大纲.md", "正文/01.md"]);
    expect(isWritingCatalogVisiblePath("自由区/试写.md", catalog, policy, "short-form")).toBe(false);
    expect(isWritingCatalogPath("正文/01.md", catalog)).toBe(true);
  });

  it("promotes paths into the catalog set", () => {
    const next = withWritingCatalogPath({ paths: ["全局/大纲.md"] }, "正文/01.md");
    expect(next.paths).toContain("全局/大纲.md");
    expect(next.paths).toContain("正文/01.md");
    expect(normalizeWritingCatalog({ paths: [" 正文/01.md ", "正文/01.md"] }).paths).toEqual(["正文/01.md"]);
  });

  it("uses the manifest project type when materializing default free roots", () => {
    const parsed = parseWritingCatalogConfig({
      schemaVersion: 1,
      type: "short-form",
      writePolicy: { mode: "catalog-plus-free" },
    });

    expect(parsed.writePolicy?.freeRoots).toEqual(["自由区", ".work"]);
  });
});
