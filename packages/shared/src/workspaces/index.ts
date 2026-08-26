// input: Workspace storage, config, paths, and application-context modules
// output: Stable public workspace and runtime-workspace exports
// pos: Shared entrypoint for project and hidden application workspace contracts

/**
 * Workspace Module
 *
 * Re-exports types and storage functions for workspaces.
 */

// Types
export type {
  WorkspaceConfig,
  CreateWorkspaceInput,
  LoadedWorkspace,
  WorkspaceSummary,
} from './types.ts';

export {
  FREE_CONVERSATION_WORKSPACE_SLUG,
  getFreeConversationWorkspace,
  isFreeConversationWorkspaceId,
  resolveRuntimeWorkspace,
  listSessionWorkspaces,
} from './application-context.ts';
export {
  isPathWithinProjectRoot,
  rebasePathWithinProjectRoot,
  getExistingWorkspaceLabelConfigPath,
  getExistingWorkspaceViewsPath,
} from './paths.ts';

export {
  canonicalizeProjectRoot,
  isWorkspaceRootAvailable,
  commitWorkspaceRootRelink,
  prepareWorkspaceRootRelink,
  rebaseWorkspaceDefaultWorkingDirectory,
  registerLocalProject,
  relinkWorkspaceRoot,
} from './project-registry.ts';
export type { WorkspaceRootRelinkPlan } from './project-registry.ts';

// Storage functions
export {
  // Path utilities
  getDefaultWorkspacesDir,
  ensureDefaultWorkspacesDir,
  getWorkspacePath,
  getWorkspaceStatePath,
  getWorkspaceConfigPath,
  getWorkspaceSourcesPath,
  getWorkspaceSessionsPath,
  getWorkspaceSkillsPath,
  getWorkspaceLabelConfigPath,
  getWorkspaceStatusConfigPath,
  getWorkspaceViewsPath,
  getWorkspaceWritingManifestPath,
  getWorkspaceAgentsPath,
  getWorkspaceClaudePath,
  getWorkspaceReadmePath,
  getWorkspaceNoticePath,
  getExistingWorkspaceConfigPath,
  getExistingWorkspaceSessionsPath,
  getExistingWorkspaceSourcesPath,
  isLocalMcpEnabled,
  // Config operations
  loadWorkspaceConfig,
  inspectWorkspaceConfig,
  inspectWorkspaceStateConfig,
  saveWorkspaceConfig,
  // Load operations
  loadWorkspace,
  // Creation and validation
  generateSlug,
  createWorkspaceAtPath,
  isValidWorkspace,
  // Constants
  CONFIG_DIR,
  DEFAULT_WORKSPACES_DIR,
} from './storage.ts';
