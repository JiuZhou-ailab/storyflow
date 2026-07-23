// input: Optional Storyflow project root and optional global-root test override
// output: Explicit high-to-low Skills, Sources, and Extensions filesystem roots
// pos: Single resource-scope contract preventing implicit third-party directory discovery

import { resolve } from 'node:path';

import { CONFIG_DIR } from '../config/paths.ts';
import {
  getWorkspaceSkillsPath,
  getWorkspaceSourcesPath,
} from '../workspaces/paths.ts';

export type ResourceOrigin = 'project' | 'global';

export interface ResolvedResourceRoot {
  origin: ResourceOrigin;
  /** Root that owns this resource directory. */
  rootPath: string;
  /** Concrete resource directory consumed by filesystem loaders. */
  path: string;
}

export interface ResolvedResourceRoots {
  /** Ordered from highest to lowest precedence. */
  skills: readonly ResolvedResourceRoot[];
  /** Ordered from highest to lowest precedence. */
  sources: readonly ResolvedResourceRoot[];
  /** Executable Extensions are global-only. */
  extensions: readonly ResolvedResourceRoot[];
}

export interface ResolveResourceRootsOptions {
  projectRoot?: string;
  /** Internal/test override. Runtime callers should use CONFIG_DIR. */
  globalRoot?: string;
}

/**
 * Resolve the complete Storyflow resource scope without reading or mutating disk.
 *
 * Callers must pass projectRoot explicitly. cwd, workspace storage, Git roots,
 * and third-party agent directories are never used as implicit resource roots.
 */
export function resolveResourceRoots(
  options: ResolveResourceRootsOptions = {},
): ResolvedResourceRoots {
  const globalRoot = resolve(options.globalRoot ?? CONFIG_DIR);
  const projectRoot = options.projectRoot
    ? resolve(options.projectRoot)
    : undefined;

  const globalSkills: ResolvedResourceRoot = {
    origin: 'global',
    rootPath: globalRoot,
    path: resolve(globalRoot, 'skills'),
  };
  const globalSources: ResolvedResourceRoot = {
    origin: 'global',
    rootPath: globalRoot,
    path: resolve(globalRoot, 'sources'),
  };
  const globalExtensions: ResolvedResourceRoot = {
    origin: 'global',
    rootPath: globalRoot,
    path: resolve(globalRoot, 'extensions'),
  };

  if (!projectRoot) {
    return {
      skills: [globalSkills],
      sources: [globalSources],
      extensions: [globalExtensions],
    };
  }

  return {
    skills: [
      {
        origin: 'project',
        rootPath: projectRoot,
        path: getWorkspaceSkillsPath(projectRoot),
      },
      globalSkills,
    ],
    sources: [
      {
        origin: 'project',
        rootPath: projectRoot,
        path: getWorkspaceSourcesPath(projectRoot),
      },
      globalSources,
    ],
    extensions: [globalExtensions],
  };
}
