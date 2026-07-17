// input: Workspace root paths
// output: Canonical Storyflow paths plus project-owned path and symlink boundary guards
// pos: Shared path contract separating app metadata from safe Pi-native project resources

import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from 'fs';
import { isAbsolute, join, relative, resolve, sep } from 'path';

export const WORKSPACE_STATE_DIR = '.craft-agent';
export const PI_PROJECT_DIR = '.pi';

export function getWorkspaceStatePath(rootPath: string): string {
  return join(rootPath, WORKSPACE_STATE_DIR);
}

export function getWorkspaceStateRelativePath(relativePath: string): string {
  return join(WORKSPACE_STATE_DIR, relativePath);
}

export function getFirstExistingPath(paths: string[]): string {
  return paths.find((path) => existsSync(path)) ?? paths[0]!;
}

export function getWorkspaceConfigPath(rootPath: string): string {
  return join(getWorkspaceStatePath(rootPath), 'config.json');
}

export function getLegacyWorkspaceConfigPath(rootPath: string): string {
  return join(rootPath, 'config.json');
}

export function getExistingWorkspaceConfigPath(rootPath: string): string {
  return getFirstExistingPath([
    getWorkspaceConfigPath(rootPath),
    getLegacyWorkspaceConfigPath(rootPath),
  ]);
}

export function getWorkspaceSourcesPath(rootPath: string): string {
  return join(getWorkspaceStatePath(rootPath), 'sources');
}

export function getLegacyWorkspaceSourcesPath(rootPath: string): string {
  return join(rootPath, 'sources');
}

export function getExistingWorkspaceSourcesPath(rootPath: string): string {
  return getFirstExistingPath([
    getWorkspaceSourcesPath(rootPath),
    getLegacyWorkspaceSourcesPath(rootPath),
  ]);
}

export function getWorkspaceSessionsPath(rootPath: string): string {
  return join(getWorkspaceStatePath(rootPath), 'sessions');
}

export function getLegacyWorkspaceSessionsPath(rootPath: string): string {
  return join(rootPath, 'sessions');
}

export function getExistingWorkspaceSessionsPath(rootPath: string): string {
  return getFirstExistingPath([
    getWorkspaceSessionsPath(rootPath),
    getLegacyWorkspaceSessionsPath(rootPath),
  ]);
}

export function getWorkspaceSkillsPath(rootPath: string): string {
  return join(rootPath, PI_PROJECT_DIR, 'skills');
}

export function getProjectSkillsLifecycleStatePath(rootPath: string): string {
  return join(getWorkspaceStatePath(rootPath), 'migrations', 'project-skills.json');
}

export function getLegacyCraftWorkspaceSkillsPath(rootPath: string): string {
  return join(getWorkspaceStatePath(rootPath), 'skills');
}

export function getLegacyWorkspaceSkillsPath(rootPath: string): string {
  return join(rootPath, 'skills');
}

export function getWorkspaceLabelsPath(rootPath: string): string {
  return join(getWorkspaceStatePath(rootPath), 'labels');
}

export function getWorkspaceLabelConfigPath(rootPath: string): string {
  return join(getWorkspaceLabelsPath(rootPath), 'config.json');
}

export function getLegacyWorkspaceLabelConfigPath(rootPath: string): string {
  return join(rootPath, 'labels', 'config.json');
}

export function getExistingWorkspaceLabelConfigPath(rootPath: string): string {
  return getFirstExistingPath([
    getWorkspaceLabelConfigPath(rootPath),
    getLegacyWorkspaceLabelConfigPath(rootPath),
  ]);
}

export function getWorkspaceStatusesPath(rootPath: string): string {
  return join(getWorkspaceStatePath(rootPath), 'statuses');
}

export function getWorkspaceStatusConfigPath(rootPath: string): string {
  return join(getWorkspaceStatusesPath(rootPath), 'config.json');
}

export function getLegacyWorkspaceStatusConfigPath(rootPath: string): string {
  return join(rootPath, 'statuses', 'config.json');
}

export function getExistingWorkspaceStatusConfigPath(rootPath: string): string {
  return getFirstExistingPath([
    getWorkspaceStatusConfigPath(rootPath),
    getLegacyWorkspaceStatusConfigPath(rootPath),
  ]);
}

export function getWorkspaceStatusIconsPath(rootPath: string): string {
  return join(getWorkspaceStatusesPath(rootPath), 'icons');
}

export function getLegacyWorkspaceStatusIconsPath(rootPath: string): string {
  return join(rootPath, 'statuses', 'icons');
}

export function getExistingWorkspaceStatusIconsPath(rootPath: string): string {
  return getFirstExistingPath([
    getWorkspaceStatusIconsPath(rootPath),
    getLegacyWorkspaceStatusIconsPath(rootPath),
  ]);
}

export function getWorkspaceViewsPath(rootPath: string): string {
  return join(getWorkspaceStatePath(rootPath), 'views.json');
}

export function getLegacyWorkspaceViewsPath(rootPath: string): string {
  return join(rootPath, 'views.json');
}

export function getExistingWorkspaceViewsPath(rootPath: string): string {
  return getFirstExistingPath([
    getWorkspaceViewsPath(rootPath),
    getLegacyWorkspaceViewsPath(rootPath),
  ]);
}

export function getWorkspaceWritingManifestPath(rootPath: string): string {
  return join(getWorkspaceStatePath(rootPath), 'craft-writing.json');
}

export function getLegacyWorkspaceWritingManifestPath(rootPath: string): string {
  return join(rootPath, 'craft-writing.json');
}

export function getExistingWorkspaceWritingManifestPath(rootPath: string): string {
  return getFirstExistingPath([
    getWorkspaceWritingManifestPath(rootPath),
    getLegacyWorkspaceWritingManifestPath(rootPath),
  ]);
}

export function getWorkspacePackLockPath(rootPath: string): string {
  return join(getWorkspaceStatePath(rootPath), 'craft-pack-lock.json');
}

export function getWorkspaceAgentsPath(rootPath: string): string {
  return join(getWorkspaceStatePath(rootPath), 'AGENTS.md');
}

export function getWorkspaceClaudePath(rootPath: string): string {
  return join(getWorkspaceStatePath(rootPath), 'CLAUDE.md');
}

export function getWorkspaceReadmePath(rootPath: string): string {
  return join(getWorkspaceStatePath(rootPath), 'README.md');
}

export function getWorkspaceNoticePath(rootPath: string, fileName: string): string {
  return join(getWorkspaceStatePath(rootPath), fileName);
}

export function getWorkspacePluginManifestPath(rootPath: string): string {
  return join(getWorkspaceStatePath(rootPath), 'claude-plugin', 'plugin.json');
}

export class UnsafeProjectPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeProjectPathError';
  }
}

function lstatIfPresent(path: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function isWithinPath(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(rootPath, candidatePath);
  return relativePath === '' || (
    relativePath !== '..'
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath)
  );
}

function getProjectBoundary(projectRoot: string): {
  lexicalRoot: string;
  canonicalRoot: string;
} {
  const lexicalRoot = resolve(projectRoot);
  const rootStat = lstatIfPresent(lexicalRoot);
  if (!rootStat) {
    throw new UnsafeProjectPathError(`Project root does not exist: ${lexicalRoot}`);
  }

  const canonicalRoot = realpathSync(lexicalRoot);
  if (!lstatSync(canonicalRoot).isDirectory()) {
    throw new UnsafeProjectPathError(`Project root is not a directory: ${lexicalRoot}`);
  }
  return { lexicalRoot, canonicalRoot };
}

function getProjectRelativeSegments(lexicalRoot: string, targetPath: string): string[] {
  const lexicalTarget = resolve(targetPath);
  if (!isWithinPath(lexicalRoot, lexicalTarget)) {
    throw new UnsafeProjectPathError(`Path escapes the project root: ${lexicalTarget}`);
  }

  const relativePath = relative(lexicalRoot, lexicalTarget);
  return relativePath ? relativePath.split(sep).filter(Boolean) : [];
}

/** Resolve an existing project-owned path without following project-internal symlinks. */
export function resolveProjectOwnedPath(projectRoot: string, targetPath: string): string {
  const { lexicalRoot, canonicalRoot } = getProjectBoundary(projectRoot);
  const segments = getProjectRelativeSegments(lexicalRoot, targetPath);
  let currentPath = lexicalRoot;

  for (const segment of segments) {
    currentPath = join(currentPath, segment);
    const stat = lstatIfPresent(currentPath);
    if (!stat) throw new UnsafeProjectPathError(`Project path does not exist: ${currentPath}`);
    if (stat.isSymbolicLink()) {
      throw new UnsafeProjectPathError(`Project path contains a symbolic link: ${currentPath}`);
    }

    const canonicalPath = realpathSync(currentPath);
    if (!isWithinPath(canonicalRoot, canonicalPath)) {
      throw new UnsafeProjectPathError(`Project path escapes its real root: ${currentPath}`);
    }
  }

  return currentPath;
}

/** Create a project-owned directory one component at a time, rejecting symlink ancestors. */
export function ensureProjectOwnedDirectory(projectRoot: string, targetPath: string): string {
  const lexicalRoot = resolve(projectRoot);
  if (!lstatIfPresent(lexicalRoot)) mkdirSync(lexicalRoot, { recursive: true });

  const boundary = getProjectBoundary(lexicalRoot);
  const segments = getProjectRelativeSegments(boundary.lexicalRoot, targetPath);
  let currentPath = boundary.lexicalRoot;

  for (const segment of segments) {
    currentPath = join(currentPath, segment);
    const existing = lstatIfPresent(currentPath);
    if (!existing) mkdirSync(currentPath);

    const stat = lstatSync(currentPath);
    if (stat.isSymbolicLink()) {
      throw new UnsafeProjectPathError(`Project path contains a symbolic link: ${currentPath}`);
    }
    if (!stat.isDirectory()) {
      throw new UnsafeProjectPathError(`Project directory path is occupied by a file: ${currentPath}`);
    }

    const canonicalPath = realpathSync(currentPath);
    if (!isWithinPath(boundary.canonicalRoot, canonicalPath)) {
      throw new UnsafeProjectPathError(`Project path escapes its real root: ${currentPath}`);
    }
  }

  return currentPath;
}

/** Reject every symlink in a Skill tree so loaders and copies cannot escape indirectly. */
export function assertSymlinkFreeTree(rootPath: string): void {
  const pending = [rootPath];
  while (pending.length > 0) {
    const currentPath = pending.pop()!;
    const stat = lstatSync(currentPath);
    if (stat.isSymbolicLink()) {
      throw new UnsafeProjectPathError(`Skill tree contains a symbolic link: ${currentPath}`);
    }
    if (!stat.isDirectory()) continue;

    for (const entry of readdirSync(currentPath)) {
      pending.push(join(currentPath, entry));
    }
  }
}
