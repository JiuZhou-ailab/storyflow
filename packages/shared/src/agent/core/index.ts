// input: Provider-agnostic Product Host capability modules
// output: Public core types, managers, and path utilities
// pos: Shared agent core API barrel

/**
 * Core Agent Module
 *
 * Provides shared functionality for the production agent runtime.
 * These modules are provider-agnostic and can be composed into any agent implementation.
 *
 * Modules:
 * - PermissionManager: Tool permission evaluation and mode management
 * - SourceManager: External data source state tracking
 * - PromptBuilder: System prompt and context building
 * - PrerequisiteManager: Prerequisite reading enforcement (guide.md before source tools)
 */

// Types
export type {
  // Core types
  RecoveryMessage,
  PermissionManagerConfig,
  ToolPermissionResult,
  SourceManagerConfig,
  PromptBuilderConfig,
  ContextBlockOptions,
  // Re-exported from mode-types
  PermissionMode,
  ModeConfig,
  CompiledApiEndpointRule,
  CompiledBashPattern,
  MismatchAnalysis,
  PermissionPaths,
  // Re-exported from mode-manager
  ToolCheckResult,
} from './types.ts';

// Constants
export {
  PERMISSION_MODE_ORDER,
  PERMISSION_MODE_CONFIG,
  SAFE_MODE_CONFIG,
} from './types.ts';

// Permission Manager
export { PermissionManager } from './permission-manager.ts';

// Source Manager
export { SourceManager } from './source-manager.ts';

// Prompt Builder
export { PromptBuilder } from './prompt-builder.ts';

// Path utilities
export {
  expandPath,
  normalizePath,
  pathStartsWith,
  toPortablePath,
} from '../../utils/paths.ts';

// PreToolUse Utilities
export {
  // Types
  type PathExpansionResult,
  type MetadataStrippingResult,
  type ConfigValidationResult as PreToolUseConfigValidationResult,
  // Centralized pipeline types
  type PreToolUseCheckResult,
  type PreToolUseInput,
  type PermissionManagerLike,
  type PrerequisiteManagerLike,
  // Constants
  BUILT_IN_TOOLS,
  FILE_PATH_TOOLS,
  CONFIG_WRITE_TOOLS,
  // Functions
  expandToolPaths,
  stripToolMetadata,
  validateConfigWrite,
  // Centralized pipeline
  runPreToolUseChecks,
  shouldPromptInAskMode,
} from './pre-tool-use.ts';

// Prerequisite Manager
export { PrerequisiteManager } from './prerequisite-manager.ts';
export type {
  PrerequisiteRule,
  PrerequisiteCheckResult,
  PrerequisiteManagerConfig,
} from './prerequisite-manager.ts';
