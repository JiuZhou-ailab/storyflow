// input: Writing project catalog paths, write policy, and relative file paths
// output: Pure helpers for optional agent write allowlist (legacy catalog-plus-free)
// pos: Backward-compat constraints; sidebar is always the real project folder

import type { MethodPackRequiredPath } from "./method-packs/types.ts";
import type {
  WritingCatalog,
  NormalizedWritingWritePolicy,
  WritingProjectType,
  WritingWritePolicy,
  WritingWritePolicyMode,
} from "./types.ts";

export type { WritingCatalog, WritingProjectType, WritingWritePolicy, WritingWritePolicyMode };

const MANIFEST_PATHS = new Set([
  "craft-writing.json",
  ".craft-agent/craft-writing.json",
]);

export const DEFAULT_CATALOG_FREE_ROOTS = [".work", "自由区"] as const;

export function normalizeWritingRelativePath(path: string): string {
  return path.replace(/\\/g, "/").trim().replace(/^\/+|\/+$/g, "");
}

export function defaultFreeRootsForProjectType(type: WritingProjectType): string[] {
  if (type === "short-form") return ["自由区", ".work"];
  if (type === "screenplay") return [".work", "自由区"];
  return [".work"];
}

export function isWritingWritePolicyMode(value: unknown): value is WritingWritePolicyMode {
  return value === "legacy" || value === "catalog-plus-free";
}

export function normalizeWritingWritePolicy(
  policy: WritingWritePolicy | null | undefined,
  projectType: WritingProjectType = "novel",
): NormalizedWritingWritePolicy {
  const mode = policy?.mode === "catalog-plus-free" ? "catalog-plus-free" : "legacy";
  const freeRoots = (policy?.freeRoots?.length
    ? policy.freeRoots
    : defaultFreeRootsForProjectType(projectType)
  )
    .map(normalizeWritingRelativePath)
    .filter(Boolean);

  return {
    mode,
    freeRoots: freeRoots.length > 0 ? freeRoots : [...DEFAULT_CATALOG_FREE_ROOTS],
  };
}

export function normalizeWritingCatalog(
  catalog: WritingCatalog | null | undefined,
): WritingCatalog {
  const paths = (catalog?.paths ?? [])
    .map(normalizeWritingRelativePath)
    .filter((path) => path.length > 0 && !MANIFEST_PATHS.has(path));

  return { paths: [...new Set(paths)].sort((a, b) => a.localeCompare(b)) };
}

/** Seed catalog from method-pack required file paths (directories are not auto-authorized). */
export function seedCatalogPathsFromRequiredPaths(
  requiredPaths: readonly MethodPackRequiredPath[],
): string[] {
  return normalizeWritingCatalog({
    paths: requiredPaths
      .filter((entry) => entry.kind === "file")
      .map((entry) => entry.path),
  }).paths;
}

export function isPathUnderWritingRoots(
  relativePath: string,
  roots: readonly string[],
): boolean {
  const path = normalizeWritingRelativePath(relativePath);
  if (!path) return false;
  return roots.some((root) => {
    const normalizedRoot = normalizeWritingRelativePath(root);
    if (!normalizedRoot) return false;
    return path === normalizedRoot || path.startsWith(`${normalizedRoot}/`);
  });
}

export function isWritingCatalogPath(
  relativePath: string,
  catalog: WritingCatalog | null | undefined,
): boolean {
  const path = normalizeWritingRelativePath(relativePath);
  if (!path) return false;
  const paths = new Set(normalizeWritingCatalog(catalog).paths);
  return paths.has(path);
}

/**
 * Whether agent Write/Edit may target this relative path.
 * legacy / missing policy → always allowed (backward compatible).
 * catalog-plus-free → catalog paths + free roots only.
 */
export function isWritingWriteAllowed(
  relativePath: string,
  catalog: WritingCatalog | null | undefined,
  policy: WritingWritePolicy | null | undefined,
  projectType: WritingProjectType = "novel",
): boolean {
  const normalizedPolicy = normalizeWritingWritePolicy(policy, projectType);
  if (normalizedPolicy.mode === "legacy") return true;

  const path = normalizeWritingRelativePath(relativePath);
  if (!path || MANIFEST_PATHS.has(path)) return false;
  if (isPathUnderWritingRoots(path, normalizedPolicy.freeRoots)) return true;
  return isWritingCatalogPath(path, catalog);
}

/**
 * Legacy helper: catalog-plus-free used to filter UI; sidebar is now always disk truth.
 * Kept for callers that still reason about the optional allowlist surface.
 * legacy / missing policy → no filtering.
 */
export function isWritingCatalogVisiblePath(
  relativePath: string,
  catalog: WritingCatalog | null | undefined,
  policy: WritingWritePolicy | null | undefined,
  projectType: WritingProjectType = "novel",
): boolean {
  const normalizedPolicy = normalizeWritingWritePolicy(policy, projectType);
  if (normalizedPolicy.mode === "legacy") return true;
  return isWritingCatalogPath(relativePath, catalog);
}

export function filterFilesByWritingCatalog<T extends { relativePath: string }>(
  files: readonly T[],
  catalog: WritingCatalog | null | undefined,
  policy: WritingWritePolicy | null | undefined,
  projectType: WritingProjectType = "novel",
): T[] {
  const normalizedPolicy = normalizeWritingWritePolicy(policy, projectType);
  if (normalizedPolicy.mode === "legacy") return [...files];
  return files.filter((file) =>
    isWritingCatalogVisiblePath(file.relativePath, catalog, normalizedPolicy, projectType),
  );
}

export function withWritingCatalogPath(
  catalog: WritingCatalog | null | undefined,
  relativePath: string,
): WritingCatalog {
  const path = normalizeWritingRelativePath(relativePath);
  if (!path || MANIFEST_PATHS.has(path)) {
    return normalizeWritingCatalog(catalog);
  }
  return normalizeWritingCatalog({
    paths: [...normalizeWritingCatalog(catalog).paths, path],
  });
}

export function parseWritingCatalogConfig(raw: unknown): {
  catalog?: WritingCatalog;
  writePolicy?: WritingWritePolicy;
} {
  if (!raw || typeof raw !== "object") return {};
  const record = raw as Record<string, unknown>;
  const projectType: WritingProjectType =
    record.type === "screenplay" || record.type === "short-form"
      ? record.type
      : "novel";

  let catalog: WritingCatalog | undefined;
  if (record.catalog && typeof record.catalog === "object") {
    const pathsRaw = (record.catalog as Record<string, unknown>).paths;
    if (Array.isArray(pathsRaw)) {
      catalog = normalizeWritingCatalog({
        paths: pathsRaw.filter((entry): entry is string => typeof entry === "string"),
      });
    }
  }

  let writePolicy: WritingWritePolicy | undefined;
  if (record.writePolicy && typeof record.writePolicy === "object") {
    const policyRaw = record.writePolicy as Record<string, unknown>;
    const mode = isWritingWritePolicyMode(policyRaw.mode) ? policyRaw.mode : "legacy";
    const freeRoots = Array.isArray(policyRaw.freeRoots)
      ? policyRaw.freeRoots.filter((entry): entry is string => typeof entry === "string")
      : undefined;
    writePolicy = normalizeWritingWritePolicy({ mode, freeRoots }, projectType);
  }

  return { catalog, writePolicy };
}
