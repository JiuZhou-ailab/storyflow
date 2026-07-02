// input: Workspace root paths
// output: Canonical app-state and legacy workspace filesystem paths
// pos: Shared path contract that keeps project content roots free of app metadata

import { existsSync } from 'fs';
import { join } from 'path';

export const WORKSPACE_STATE_DIR = '.craft-agent';

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
  return join(getWorkspaceStatePath(rootPath), 'skills');
}

export function getLegacyWorkspaceSkillsPath(rootPath: string): string {
  return join(rootPath, 'skills');
}

export function getExistingWorkspaceSkillsPath(rootPath: string): string {
  return getFirstExistingPath([
    getWorkspaceSkillsPath(rootPath),
    getLegacyWorkspaceSkillsPath(rootPath),
  ]);
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
