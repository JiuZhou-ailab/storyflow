// input: Resource resolver, portable bundles, and local install provenance
// output: Stable shared exports for resolution, import/export, receipt queries, and Skill upgrades
// pos: Public entrypoint for Storyflow-owned resource contracts

/**
 * Resource Bundle — Workspace resource export/import
 */

export type {
  ResourceBundle,
  SourceBundleEntry,
  SkillBundleEntry,
  AutomationBundleEntry,
  ResourceImportMode,
  SkillInstallScope,
  SkillInstallReceipt,
  SkillInstallArtifact,
  SkillUpgradeResult,
  SkillUpgradeOptions,
  ResourceImportOptions,
  ExportResourcesOptions,
  ExportResult,
  ImportBucketResult,
  ResourceImportResult,
  ResourceImportDeps,
} from './types.ts'

export { MAX_SKILL_INSTALL_ARTIFACT_BYTES, SKILL_INSTALL_RECEIPT_FILE } from './types.ts'

export {
  exportResources,
  importResources,
  validateResourceBundle,
} from './resource-bundle.ts'

export {
  readSkillInstallReceipt,
  listSkillInstallReceipts,
  upgradeInstalledSkill,
} from './install-receipts.ts'

export {
  resolveResourceRoots,
  type ResolveResourceRootsOptions,
  type ResolvedResourceRoot,
  type ResolvedResourceRoots,
  type ResourceOrigin,
} from './resolver.ts'
