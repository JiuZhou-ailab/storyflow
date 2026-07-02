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
  getExistingWorkspaceSkillsPath,
  // Config operations
  loadWorkspaceConfig,
  saveWorkspaceConfig,
  // Load operations
  loadWorkspace,
  getWorkspaceSummary,
  // Create/Delete operations
  generateSlug,
  generateUniqueWorkspacePath,
  createWorkspaceAtPath,
  createNovelWorkspaceAtPath,
  createDefaultWorkspaceAtPath,
  deleteWorkspaceFolder,
  isValidWorkspace,
  renameWorkspaceFolder,
  // Auto-discovery
  discoverWorkspacesInDefaultLocation,
  // Constants
  CONFIG_DIR,
  DEFAULT_WORKSPACES_DIR,
  DEFAULT_STARTER_WORKSPACE_NAME,
  DEFAULT_STARTER_WORKSPACE_METHOD_PACK_ID,
} from './storage.ts';
