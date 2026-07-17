export type WritingProjectType = "novel" | "screenplay" | "short-form";

/**
 * User-authorized working surface. Sidebar (under catalog-plus-free) only
 * renders these relative paths; agent writes are limited to catalog + freeRoots.
 */
export interface WritingCatalog {
  paths: string[];
}

/**
 * legacy: current behavior (disk scan + open writes within workspace policy).
 * catalog-plus-free: catalog is the authorized surface; freeRoots are scratch.
 */
export type WritingWritePolicyMode = "legacy" | "catalog-plus-free";

export interface WritingWritePolicy {
  mode: WritingWritePolicyMode;
  /** Relative roots where agent may write without promoting into catalog. */
  freeRoots?: string[];
}

/** Fully materialized write policy used by runtime authorization checks. */
export interface NormalizedWritingWritePolicy extends WritingWritePolicy {
  freeRoots: string[];
}

export interface WritingProjectManifest {
  schemaVersion: 1;
  type: WritingProjectType;
  title?: string;
  language?: string;
  profile?: string;
  methodPack?: {
    id: string;
    version: number;
  };
  storageProfile?: string;
  /** Present when the project opts into user-authorized catalog constraints. */
  catalog?: WritingCatalog;
  writePolicy?: WritingWritePolicy;
}

export interface WritingProjectDirectories {
  bible?: string;
  story?: string;
  state?: string;
  timeline?: string;
  analysis?: string;
  work?: string;
  brief?: string;
  notes?: string;
  style?: string;
  drafts?: string;
  revisions?: string;
  published?: string;
  reviews?: string;
}

export interface DetectedWritingProject {
  type: WritingProjectType;
  source: "manifest" | "structure";
  rootPath: string;
  manifest: WritingProjectManifest;
  directories: WritingProjectDirectories;
}
