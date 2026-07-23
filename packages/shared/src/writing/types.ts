export type WritingProjectType = "novel" | "screenplay" | "short-form";

/**
 * Optional legacy allowlist for agent Write/Edit when writePolicy is catalog-plus-free.
 * Sidebar always shows the real project tree; new projects omit this field.
 */
export interface WritingCatalog {
  paths: string[];
}

/**
 * legacy / missing: workspace folder is the surface (WYSIWYG).
 * catalog-plus-free: optional agent-only write allowlist (existing projects).
 */
export type WritingWritePolicyMode = "legacy" | "catalog-plus-free";

export interface WritingWritePolicy {
  mode: WritingWritePolicyMode;
  /** Relative roots where agent may write under catalog-plus-free. */
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
  /** Legacy agent write allowlist; not used for sidebar visibility. */
  catalog?: WritingCatalog;
  /** Missing/legacy = full workspace surface. */
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
