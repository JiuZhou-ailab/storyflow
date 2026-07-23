// input: Resource resolver and portable resource-bundle modules
// output: Stable shared exports for resolution, import, and export
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
  ExportResourcesOptions,
  ExportResult,
  ImportBucketResult,
  ResourceImportResult,
  ResourceImportDeps,
} from './types.ts'

export {
  exportResources,
  importResources,
  validateResourceBundle,
} from './resource-bundle.ts'

export {
  resolveResourceRoots,
  type ResolveResourceRootsOptions,
  type ResolvedResourceRoot,
  type ResolvedResourceRoots,
  type ResourceOrigin,
} from './resolver.ts'
