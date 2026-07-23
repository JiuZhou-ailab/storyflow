/**
 * Workspace Storage
 *
 * input: Workspace folders, global defaults, and persisted workspace config files
 * output: Workspace CRUD, discovery, and default-setting persistence
 * pos: Shared filesystem-backed workspace storage layer
 *
 * CRUD operations for workspaces.
 * Workspaces can be stored anywhere on disk via rootPath.
 * Default location: ~/.craft-agent/workspaces/
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { expandPath, toPortablePath } from '../utils/paths.ts';
import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts';
import { getDefaultStatusConfig, saveStatusConfig, ensureDefaultIconFiles } from '../statuses/storage.ts';
import { getDefaultLabelConfig, saveLabelConfig } from '../labels/storage.ts';
import { loadConfigDefaults } from '../config/storage.ts';
import { parsePermissionMode, PERMISSION_MODE_ORDER } from '../agent/mode-types.ts';
import { normalizeThinkingLevel } from '../agent/thinking-levels.ts';
import { ensureProjectSkillsLifecycle } from '../agent-defaults/default-agent-resources.ts';
import { createNovelProjectScaffold } from '../writing/novel-template.ts';
import { detectWritingProject } from '../writing/manifest.ts';
import { getBuiltInMethodPack, type MethodPackId } from '../writing/method-packs/index.ts';
import type {
  WorkspaceConfig,
  CreateWorkspaceInput,
  LoadedWorkspace,
  WorkspaceSummary,
} from './types.ts';
import {
  getExistingWorkspaceConfigPath,
  getExistingWorkspaceSessionsPath,
  getExistingWorkspaceSourcesPath,
  getLegacyCraftWorkspaceSkillsPath,
  getLegacyWorkspaceSkillsPath,
  getLegacyWorkspaceConfigPath,
  getWorkspaceConfigPath,
  getWorkspaceAgentsPath,
  getWorkspaceClaudePath,
  getWorkspaceLabelsPath,
  getWorkspaceNoticePath,
  getWorkspacePackLockPath,
  getWorkspacePluginManifestPath,
  getWorkspaceReadmePath,
  getWorkspaceSessionsPath,
  getWorkspaceSkillsPath,
  getWorkspaceSourcesPath,
  getWorkspaceStatePath,
  getWorkspaceStatusConfigPath,
  getWorkspaceStatusIconsPath,
  getWorkspaceViewsPath,
  getWorkspaceWritingManifestPath,
} from './paths.ts';

export {
  WORKSPACE_STATE_DIR,
  getExistingWorkspaceConfigPath,
  getExistingWorkspaceLabelConfigPath,
  getExistingWorkspaceSessionsPath,
  getExistingWorkspaceSourcesPath,
  getExistingWorkspaceStatusConfigPath,
  getExistingWorkspaceStatusIconsPath,
  getExistingWorkspaceViewsPath,
  getExistingWorkspaceWritingManifestPath,
  getLegacyCraftWorkspaceSkillsPath,
  getLegacyWorkspaceConfigPath,
  getLegacyWorkspaceLabelConfigPath,
  getLegacyWorkspaceSessionsPath,
  getLegacyWorkspaceSkillsPath,
  getLegacyWorkspaceSourcesPath,
  getLegacyWorkspaceStatusConfigPath,
  getLegacyWorkspaceStatusIconsPath,
  getLegacyWorkspaceViewsPath,
  getLegacyWorkspaceWritingManifestPath,
  getWorkspaceAgentsPath,
  getWorkspaceClaudePath,
  getWorkspaceConfigPath,
  getWorkspaceLabelConfigPath,
  getWorkspaceLabelsPath,
  getWorkspaceNoticePath,
  getWorkspacePackLockPath,
  getWorkspacePluginManifestPath,
  getWorkspaceReadmePath,
  getWorkspaceSessionsPath,
  getWorkspaceSkillsPath,
  getWorkspaceSourcesPath,
  getWorkspaceStatePath,
  getWorkspaceStateRelativePath,
  getWorkspaceStatusConfigPath,
  getWorkspaceStatusIconsPath,
  getWorkspaceStatusesPath,
  getWorkspaceViewsPath,
  getWorkspaceWritingManifestPath,
} from './paths.ts';

export const DEFAULT_STARTER_WORKSPACE_NAME = '短篇/中篇小说';
export const DEFAULT_STARTER_WORKSPACE_METHOD_PACK_ID = 'short-form.article' satisfies MethodPackId;

const CONFIG_DIR = join(homedir(), '.craft-agent');
const DEFAULT_WORKSPACES_DIR = join(CONFIG_DIR, 'workspaces');

// ============================================================
// Path Utilities
// ============================================================

/**
 * Get the default workspaces directory (~/.craft-agent/workspaces/)
 */
export function getDefaultWorkspacesDir(): string {
  return DEFAULT_WORKSPACES_DIR;
}

/**
 * Ensure default workspaces directory exists
 */
export function ensureDefaultWorkspacesDir(): void {
  if (!existsSync(DEFAULT_WORKSPACES_DIR)) {
    mkdirSync(DEFAULT_WORKSPACES_DIR, { recursive: true });
  }
}

/**
 * Get workspace root path from ID
 * @param workspaceId - Workspace ID
 * @returns Absolute path to workspace root in default location
 */
export function getWorkspacePath(workspaceId: string): string {
  return join(DEFAULT_WORKSPACES_DIR, workspaceId);
}

// ============================================================
// Config Operations
// ============================================================

function isWorkspaceConfigLike(value: unknown): value is WorkspaceConfig {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WorkspaceConfig>;
  return (
    typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.slug === 'string'
    && typeof candidate.createdAt === 'number'
  );
}

function hasLegacyWorkspaceConfig(rootPath: string): boolean {
  const legacyConfigPath = getLegacyWorkspaceConfigPath(rootPath);
  if (!existsSync(legacyConfigPath)) return false;

  try {
    return isWorkspaceConfigLike(JSON.parse(readFileSync(legacyConfigPath, 'utf-8')));
  } catch {
    return false;
  }
}

function hasLegacyWritingManifest(rootPath: string): boolean {
  const manifestPath = join(rootPath, 'craft-writing.json');
  if (!existsSync(manifestPath)) return false;

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    return manifest.schemaVersion === 1 && typeof manifest.type === 'string';
  } catch {
    return false;
  }
}

function filesMatch(leftPath: string, rightPath: string): boolean {
  try {
    const left = statSync(leftPath);
    const right = statSync(rightPath);
    return left.isFile() && right.isFile() && readFileSync(leftPath).equals(readFileSync(rightPath));
  } catch {
    return false;
  }
}

function isDirectoryPath(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function uniqueLegacyStatePath(rootPath: string, name: string): string {
  const parsed = name.match(/^(.*?)(\.[^.]*)?$/);
  const stem = parsed?.[1] || name;
  const ext = parsed?.[2] || '';
  let candidate = join(getWorkspaceStatePath(rootPath), 'legacy-root', name);
  let counter = 2;

  while (existsSync(candidate)) {
    candidate = join(getWorkspaceStatePath(rootPath), 'legacy-root', `${stem}-${counter++}${ext}`);
  }
  return candidate;
}

function moveLegacyWorkspaceConflict(rootPath: string, sourcePath: string): void {
  const relativePath = sourcePath.startsWith(`${rootPath}/`)
    ? sourcePath.slice(rootPath.length + 1)
    : sourcePath;
  const fallbackPath = uniqueLegacyStatePath(rootPath, relativePath);
  mkdirSync(dirname(fallbackPath), { recursive: true });
  renameSync(sourcePath, fallbackPath);
}

function mergeLegacyDirectory(rootPath: string, sourceDir: string, targetDir: string): void {
  mkdirSync(targetDir, { recursive: true });

  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);

    if (!existsSync(targetPath)) {
      renameSync(sourcePath, targetPath);
      continue;
    }

    if (entry.isDirectory() && isDirectoryPath(targetPath)) {
      mergeLegacyDirectory(rootPath, sourcePath, targetPath);
      rmSync(sourcePath, { recursive: true, force: true });
      continue;
    }

    if (entry.isFile() && filesMatch(sourcePath, targetPath)) {
      rmSync(sourcePath, { recursive: true, force: true });
      continue;
    }

    moveLegacyWorkspaceConflict(rootPath, sourcePath);
  }
}

function moveLegacyWorkspaceStatePath(rootPath: string, sourcePath: string, targetPath: string): void {
  if (!existsSync(sourcePath)) return;

  if (existsSync(targetPath)) {
    if (isDirectoryPath(sourcePath) && isDirectoryPath(targetPath)) {
      mergeLegacyDirectory(rootPath, sourcePath, targetPath);
      rmSync(sourcePath, { recursive: true, force: true });
      return;
    }
    if (filesMatch(sourcePath, targetPath)) {
      rmSync(sourcePath, { recursive: true, force: true });
      return;
    }
    moveLegacyWorkspaceConflict(rootPath, sourcePath);
    return;
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  renameSync(sourcePath, targetPath);
}

function restoreMergeableLegacyRootState(rootPath: string): void {
  const legacyRoot = join(getWorkspaceStatePath(rootPath), 'legacy-root');
  if (!existsSync(legacyRoot)) return;

  for (const [source, target] of [
    ['sessions', getWorkspaceSessionsPath(rootPath)],
    ['sources', getWorkspaceSourcesPath(rootPath)],
  ] as const) {
    const sourcePath = join(legacyRoot, source);
    if (!existsSync(sourcePath)) continue;
    mergeLegacyDirectory(rootPath, sourcePath, target);
    rmSync(sourcePath, { recursive: true, force: true });
  }

  try {
    if (readdirSync(legacyRoot).length === 0) {
      rmSync(legacyRoot, { recursive: true, force: true });
    }
  } catch {
    // ignore best-effort cleanup
  }
}

function migrateLegacyWorkspaceState(rootPath: string): void {
  const hasLegacyConfig = hasLegacyWorkspaceConfig(rootPath);
  const hasWritingManifest = hasLegacyWritingManifest(rootPath);
  if (!hasLegacyConfig && !hasWritingManifest) {
    restoreMergeableLegacyRootState(rootPath);
    return;
  }

  mkdirSync(getWorkspaceStatePath(rootPath), { recursive: true });

  if (hasLegacyConfig) {
    for (const [source, target] of [
      ['config.json', getWorkspaceConfigPath(rootPath)],
      ['sources', getWorkspaceSourcesPath(rootPath)],
      ['sessions', getWorkspaceSessionsPath(rootPath)],
      ['labels', getWorkspaceLabelsPath(rootPath)],
      ['statuses/config.json', getWorkspaceStatusConfigPath(rootPath)],
      ['statuses/icons', getWorkspaceStatusIconsPath(rootPath)],
      ['views.json', getWorkspaceViewsPath(rootPath)],
      ['.claude-plugin/plugin.json', getWorkspacePluginManifestPath(rootPath)],
    ] as const) {
      moveLegacyWorkspaceStatePath(rootPath, join(rootPath, source), target);
    }

    rmSync(join(rootPath, '.claude-plugin'), { recursive: true, force: true });
    try {
      if (existsSync(join(rootPath, 'statuses')) && readdirSync(join(rootPath, 'statuses')).length === 0) {
        rmSync(join(rootPath, 'statuses'), { recursive: true, force: true });
      }
    } catch {
      // ignore best-effort cleanup
    }
  }

  if (!hasWritingManifest) {
    restoreMergeableLegacyRootState(rootPath);
    return;
  }

  for (const [source, target] of [
    ['craft-writing.json', getWorkspaceWritingManifestPath(rootPath)],
    ['craft-pack-lock.json', getWorkspacePackLockPath(rootPath)],
    ['AGENTS.md', getWorkspaceAgentsPath(rootPath)],
    ['CLAUDE.md', getWorkspaceClaudePath(rootPath)],
    ['README.md', getWorkspaceReadmePath(rootPath)],
  ] as const) {
    moveLegacyWorkspaceStatePath(rootPath, join(rootPath, source), target);
  }

  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/^NOTICE-.+\.md$/.test(entry.name)) continue;
    moveLegacyWorkspaceStatePath(rootPath, join(rootPath, entry.name), getWorkspaceNoticePath(rootPath, entry.name));
  }

  restoreMergeableLegacyRootState(rootPath);
}

/**
 * Load workspace config.json from a workspace folder
 * @param rootPath - Absolute path to workspace root folder
 */
export function loadWorkspaceConfig(rootPath: string): WorkspaceConfig | null {
  migrateLegacyWorkspaceState(rootPath);

  const configPath = getExistingWorkspaceConfigPath(rootPath);
  if (!existsSync(configPath)) return null;

  try {
    const config = readJsonFileSync<WorkspaceConfig>(configPath);
    ensureProjectSkillsLifecycle(rootPath);

    // Expand path variables in defaults for portability
    if (config.defaults?.workingDirectory) {
      config.defaults.workingDirectory = expandPath(config.defaults.workingDirectory);
    }

    // Compatibility: accept canonical or legacy permission mode names on read
    if (config.defaults?.permissionMode && typeof config.defaults.permissionMode === 'string') {
      const parsed = parsePermissionMode(config.defaults.permissionMode);
      config.defaults.permissionMode = parsed ?? undefined;
    }

    if (Array.isArray(config.defaults?.cyclablePermissionModes)) {
      const normalized = config.defaults.cyclablePermissionModes
        .map(mode => (typeof mode === 'string' ? parsePermissionMode(mode) : null))
        .filter((mode): mode is NonNullable<typeof mode> => !!mode)
        .filter((mode, index, arr) => arr.indexOf(mode) === index);

      config.defaults.cyclablePermissionModes = normalized.length >= 2
        ? normalized
        : [...PERMISSION_MODE_ORDER];
    }

    if (config.defaults && 'thinkingLevel' in config.defaults) {
      // TODO: Remove legacy 'think' normalization after old persisted workspace configs
      // have realistically aged out across upgrades.
      config.defaults.thinkingLevel = normalizeThinkingLevel(config.defaults.thinkingLevel);
    }

    const writingProject = detectWritingProject(rootPath);
    if (writingProject) {
      const detectedMethodPackId = writingProject.manifest.methodPack?.id;
      const detectedMethodPack = detectedMethodPackId ? getBuiltInMethodPack(detectedMethodPackId) : null;

      if (!detectedMethodPackId && writingProject.type === 'novel') {
        createNovelProjectScaffold(rootPath, {
          title: config.name,
        });
      } else if (detectedMethodPack && detectedMethodPack.projectType === writingProject.type) {
        createNovelProjectScaffold(rootPath, {
          title: config.name,
          methodPackId: detectedMethodPack.id,
        });
      }
    }

    if (!config.defaults?.workingDirectory && writingProject && writingProject.type !== 'screenplay') {
      config.defaults = {
        ...config.defaults,
        workingDirectory: rootPath,
      };
      saveWorkspaceConfig(rootPath, config);
    }

    return config;
  } catch {
    return null;
  }
}

/**
 * Save workspace config.json to a workspace folder
 * @param rootPath - Absolute path to workspace root folder
 */
export function saveWorkspaceConfig(rootPath: string, config: WorkspaceConfig): void {
  if (!existsSync(rootPath)) {
    mkdirSync(rootPath, { recursive: true });
  }

  // Convert paths to portable form for cross-machine compatibility
  const storageConfig: WorkspaceConfig = {
    ...config,
    updatedAt: Date.now(),
  };

  if (storageConfig.defaults?.workingDirectory) {
    storageConfig.defaults = {
      ...storageConfig.defaults,
      workingDirectory: toPortablePath(storageConfig.defaults.workingDirectory),
    };
  }

  // Use atomic write to prevent corruption on crash/interrupt
  const configPath = getWorkspaceConfigPath(rootPath);
  mkdirSync(dirname(configPath), { recursive: true });
  atomicWriteFileSync(configPath, JSON.stringify(storageConfig, null, 2));
}

// ============================================================
// Load Operations
// ============================================================

/**
 * Count subdirectories in a path
 */
function countSubdirs(dirPath: string): number {
  if (!existsSync(dirPath)) return 0;
  try {
    return readdirSync(dirPath, { withFileTypes: true }).filter((d) => d.isDirectory()).length;
  } catch {
    return 0;
  }
}

/**
 * List subdirectory names in a path
 */
function listSubdirNames(dirPath: string): string[] {
  if (!existsSync(dirPath)) return [];
  try {
    return readdirSync(dirPath, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * Load workspace with summary info from a rootPath
 * @param rootPath - Absolute path to workspace root folder
 */
export function loadWorkspace(rootPath: string): LoadedWorkspace | null {
  const config = loadWorkspaceConfig(rootPath);
  if (!config) return null;

  // Ensure plugin manifest exists (migration for existing workspaces)
  ensurePluginManifest(rootPath, config.name);

  return {
    config,
    sourceSlugs: listSubdirNames(getExistingWorkspaceSourcesPath(rootPath)),
    sessionCount: countSubdirs(getExistingWorkspaceSessionsPath(rootPath)),
  };
}

/**
 * Get workspace summary from a rootPath
 * @param rootPath - Absolute path to workspace root folder
 */
export function getWorkspaceSummary(rootPath: string): WorkspaceSummary | null {
  const config = loadWorkspaceConfig(rootPath);
  if (!config) return null;

  return {
    slug: config.slug,
    name: config.name,
    sourceCount: countSubdirs(getExistingWorkspaceSourcesPath(rootPath)),
    sessionCount: countSubdirs(getExistingWorkspaceSessionsPath(rootPath)),
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

// ============================================================
// Create/Delete Operations
// ============================================================

/**
 * Generate URL-safe slug from name
 */
export function generateSlug(name: string): string {
  const trimmed = name.trim();
  let slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);

  if (!slug) {
    let hash = 0x811c9dc5;
    for (const char of trimmed) {
      hash ^= char.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    slug = trimmed ? `workspace-${hash.toString(36)}` : 'workspace';
  }

  return slug;
}

/**
 * Generate a unique folder path for a workspace by appending a numeric suffix
 * if the slug-based folder already exists.
 * E.g., "my-workspace", "my-workspace-2", "my-workspace-3", ...
 *
 * @param name - Display name to derive the slug from
 * @param baseDir - Parent directory where workspace folders live (e.g., ~/.craft-agent/workspaces/)
 * @returns Full path to a unique, non-existing folder
 */
export function generateUniqueWorkspacePath(name: string, baseDir: string): string {
  const slug = generateSlug(name);
  let candidate = join(baseDir, slug);

  if (!existsSync(candidate)) {
    return candidate;
  }

  // Append numeric suffix until we find a non-existing path
  let counter = 2;
  while (existsSync(join(baseDir, `${slug}-${counter}`))) {
    counter++;
  }

  return join(baseDir, `${slug}-${counter}`);
}

/**
 * Create workspace folder structure at a given path
 * @param rootPath - Absolute path where workspace folder will be created
 * @param name - Display name for the workspace
 * @param defaults - Optional default settings for new sessions
 * @returns The created WorkspaceConfig
 */
export function createWorkspaceAtPath(
  rootPath: string,
  name: string,
  defaults?: WorkspaceConfig['defaults']
): WorkspaceConfig {
  const now = Date.now();
  const slug = generateSlug(name);

  // Load global defaults from config-defaults.json
  const globalDefaults = loadConfigDefaults();

  // Merge global defaults with provided defaults
  // AI settings (model, thinkingLevel, defaultLlmConnection) are left undefined
  // so they fall back to app-level defaults
  const workspaceDefaults: WorkspaceConfig['defaults'] = {
    model: undefined,
    thinkingLevel: undefined,
    // defaultLlmConnection: undefined - falls back to app default
    permissionMode: globalDefaults.workspaceDefaults.permissionMode,
    cyclablePermissionModes: globalDefaults.workspaceDefaults.cyclablePermissionModes,
    enabledSourceSlugs: [],
    workingDirectory: undefined,
    ...defaults, // User-provided defaults override global defaults
  };

  const config: WorkspaceConfig = {
    id: `ws_${randomUUID().slice(0, 8)}`,
    name,
    slug,
    defaults: workspaceDefaults,
    localMcpServers: globalDefaults.workspaceDefaults.localMcpServers,
    createdAt: now,
    updatedAt: now,
  };

  // Create workspace directory structure
  mkdirSync(rootPath, { recursive: true });
  mkdirSync(getWorkspaceStatePath(rootPath), { recursive: true });
  mkdirSync(getWorkspaceSourcesPath(rootPath), { recursive: true });
  mkdirSync(getWorkspaceSessionsPath(rootPath), { recursive: true });
  ensureProjectSkillsLifecycle(rootPath);

  // Save config
  saveWorkspaceConfig(rootPath, config);

  // Initialize status configuration with defaults
  saveStatusConfig(rootPath, getDefaultStatusConfig());
  ensureDefaultIconFiles(rootPath);

  // Initialize label configuration with defaults (two nested groups + valued labels)
  saveLabelConfig(rootPath, getDefaultLabelConfig());

  // Initialize plugin manifest for SDK integration (enables skills, commands, agents)
  ensurePluginManifest(rootPath, name);

  return config;
}

/**
 * Create a workspace folder structure and seed it as a novel writing project.
 * Existing generic workspace behavior remains unchanged; callers must opt in.
 *
 * @param rootPath - Absolute path where workspace folder will be created
 * @param name - Display name for the workspace and novel title
 * @param defaults - Optional default settings for new sessions
 * @returns The created WorkspaceConfig
 */
export function createNovelWorkspaceAtPath(
  rootPath: string,
  name: string,
  defaults?: WorkspaceConfig['defaults'],
  methodPackId: MethodPackId = 'short-form.article'
): WorkspaceConfig {
  const methodPack = getBuiltInMethodPack(methodPackId);
  if (!methodPack) {
    throw new Error(`Unknown method pack: ${methodPackId}`);
  }

  const config = createWorkspaceAtPath(rootPath, name, {
    ...defaults,
    workingDirectory: rootPath,
  });
  createNovelProjectScaffold(rootPath, { title: name, methodPackId: methodPack.id });
  // No seeded "Start writing" monologue — empty project, user starts the first chat.
  // Method guidance stays in AGENTS.md / runtime context, not as a fake assistant turn.
  return config;
}

export function createDefaultWorkspaceAtPath(rootPath: string): WorkspaceConfig {
  return createNovelWorkspaceAtPath(
    rootPath,
    DEFAULT_STARTER_WORKSPACE_NAME,
    undefined,
    DEFAULT_STARTER_WORKSPACE_METHOD_PACK_ID,
  );
}

/**
 * Delete a workspace folder and all its contents
 * @param rootPath - Absolute path to workspace root folder
 */
export function deleteWorkspaceFolder(rootPath: string): boolean {
  if (!existsSync(rootPath)) return false;

  try {
    rmSync(rootPath, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a valid workspace exists at a path
 * @param rootPath - Absolute path to check
 */
export function isValidWorkspace(rootPath: string): boolean {
  return existsSync(getExistingWorkspaceConfigPath(rootPath));
}

/**
 * Rename a workspace (updates config.json in the workspace folder)
 * @param rootPath - Absolute path to workspace root folder
 * @param newName - New display name
 */
export function renameWorkspaceFolder(rootPath: string, newName: string): boolean {
  const config = loadWorkspaceConfig(rootPath);
  if (!config) return false;

  config.name = newName.trim();
  saveWorkspaceConfig(rootPath, config);
  return true;
}

// ============================================================
// Auto-Discovery (for default workspace location)
// ============================================================

/**
 * Discover workspace folders in the default location that have valid config.json
 * Returns paths to valid workspaces found in ~/.craft-agent/workspaces/
 */
export function discoverWorkspacesInDefaultLocation(): string[] {
  const discovered: string[] = [];

  if (!existsSync(DEFAULT_WORKSPACES_DIR)) {
    return discovered;
  }

  try {
    const entries = readdirSync(DEFAULT_WORKSPACES_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const rootPath = join(DEFAULT_WORKSPACES_DIR, entry.name);
      if (isValidWorkspace(rootPath)) {
        discovered.push(rootPath);
      }
    }
  } catch {
    // Ignore errors scanning directory
  }

  return discovered;
}

// ============================================================
// Workspace Color Theme
// ============================================================

/**
 * Get the color theme setting for a workspace.
 * Returns undefined if workspace uses the app default.
 *
 * @param rootPath - Absolute path to workspace root folder
 * @returns Theme ID or undefined (inherit from app default)
 */
export function getWorkspaceColorTheme(rootPath: string): string | undefined {
  const config = loadWorkspaceConfig(rootPath);
  return config?.defaults?.colorTheme;
}

/**
 * Set the color theme for a workspace.
 * Pass undefined to clear and use app default.
 *
 * @param rootPath - Absolute path to workspace root folder
 * @param themeId - Preset theme ID or undefined to inherit
 */
export function setWorkspaceColorTheme(rootPath: string, themeId: string | undefined): void {
  const config = loadWorkspaceConfig(rootPath);
  if (!config) return;

  // Validate theme ID if provided (skip for undefined = inherit default)
  // Only allow alphanumeric characters, hyphens, and underscores (max 64 chars)
  if (themeId && themeId !== 'default') {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(themeId)) {
      console.warn(`[workspace-storage] Invalid theme ID rejected: ${themeId}`);
      return;
    }
  }

  // Initialize defaults if not present
  if (!config.defaults) {
    config.defaults = {};
  }

  if (themeId) {
    config.defaults.colorTheme = themeId;
  } else {
    delete config.defaults.colorTheme;
  }

  saveWorkspaceConfig(rootPath, config);
}

// ============================================================
// Local MCP Configuration
// ============================================================

/**
 * Check if local (stdio) MCP servers are enabled for a workspace.
 * Resolution order: ENV (CRAFT_LOCAL_MCP_ENABLED) > workspace config > default (true)
 *
 * @param rootPath - Absolute path to workspace root folder
 * @returns true if local MCP servers should be enabled
 */
export function isLocalMcpEnabled(rootPath: string): boolean {
  // 1. Environment variable override (highest priority)
  const envValue = process.env.CRAFT_LOCAL_MCP_ENABLED;
  if (envValue !== undefined) {
    return envValue.toLowerCase() === 'true';
  }

  // 2. Workspace config
  const config = loadWorkspaceConfig(rootPath);
  if (config?.localMcpServers?.enabled !== undefined) {
    return config.localMcpServers.enabled;
  }

  // 3. Default: enabled
  return true;
}

// ============================================================
// Exports
// ============================================================

// ============================================================
// Plugin Manifest (for SDK plugin integration)
// ============================================================

/**
 * Ensure workspace has a .claude-plugin/plugin.json manifest.
 * This allows the workspace to be loaded as an SDK plugin,
 * enabling skills, commands, and agents from the workspace.
 *
 * @param rootPath - Absolute path to workspace root folder
 * @param workspaceName - Display name for the workspace (used in plugin name)
 */
export function ensurePluginManifest(rootPath: string, workspaceName: string): void {
  const manifestPath = getWorkspacePluginManifestPath(rootPath);
  const pluginDir = dirname(manifestPath);

  if (existsSync(manifestPath)) return;

  // Create .claude-plugin directory
  if (!existsSync(pluginDir)) {
    mkdirSync(pluginDir, { recursive: true });
  }

  // Create minimal plugin manifest
  const manifest = {
    name: `craft-workspace-${workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    version: '1.0.0',
  };

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

export { CONFIG_DIR, DEFAULT_WORKSPACES_DIR };
