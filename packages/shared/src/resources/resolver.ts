// input: Optional Storyflow project root and optional global-root test override
// output: Global Skills/Extensions plus project-over-global Sources filesystem roots
// pos: Single resource-scope contract preventing implicit third-party directory discovery

import { resolve } from 'node:path';

import { CONFIG_DIR } from '../config/paths.ts';
import { getWorkspaceSourcesPath } from '../workspaces/paths.ts';

export type ResourceOrigin = 'project' | 'global';

export interface ResolvedResourceRoot {
  origin: ResourceOrigin;
  /** Root that owns this resource directory. */
  rootPath: string;
  /** Concrete resource directory consumed by filesystem loaders. */
  path: string;
}

export interface ResolvedResourceRoots {
  /** Global Agent Skills directory. */
  skillsPath: string;
  /** Ordered from highest to lowest precedence. */
  sources: readonly ResolvedResourceRoot[];
  /** Global executable Extensions directory. */
  extensionsPath: string;
}

export interface ResolveResourceRootsOptions {
  projectRoot?: string;
  /** Internal/test override. Runtime callers should use CONFIG_DIR. */
  globalRoot?: string;
}

/**
 * Resolve the complete Storyflow resource scope without reading or mutating disk.
 *
 * cwd, workspace storage, Git roots, and third-party agent directories are
 * never used as implicit resource roots.
 */
export function resolveResourceRoots(
  options: ResolveResourceRootsOptions = {},
): ResolvedResourceRoots {
  const globalRoot = resolve(options.globalRoot ?? CONFIG_DIR);
  const projectRoot = options.projectRoot
    ? resolve(options.projectRoot)
    : undefined;

  const globalSources: ResolvedResourceRoot = {
    origin: 'global',
    rootPath: globalRoot,
    path: resolve(globalRoot, 'sources'),
  };

  if (!projectRoot) {
    return {
      skillsPath: resolve(globalRoot, 'skills'),
      sources: [globalSources],
      extensionsPath: resolve(globalRoot, 'extensions'),
    };
  }

  return {
    skillsPath: resolve(globalRoot, 'skills'),
    sources: [
      {
        origin: 'project',
        rootPath: projectRoot,
        path: getWorkspaceSourcesPath(projectRoot),
      },
      globalSources,
    ],
    extensionsPath: resolve(globalRoot, 'extensions'),
  };
}
