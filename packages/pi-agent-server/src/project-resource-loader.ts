// input: Optional Storyflow project root, global resource root, Pi cwd, and isolated agent directory
// output: Explicit project-over-global Skills and global-only Extensions for the Pi runtime
// pos: Resource security boundary preventing Pi's implicit third-party discovery

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  DefaultResourceLoader,
  SettingsManager,
  type ResourceLoader,
} from '@earendil-works/pi-coding-agent';

import {
  assertSymlinkFreeTree,
  ensureProjectOwnedDirectory,
} from '../../shared/src/workspaces/paths.ts';
import { resolveResourceRoots } from '../../shared/src/resources/resolver.ts';

export interface ProjectResourceLoaderOptions {
  cwd: string;
  projectRoot?: string;
  globalRoot?: string;
  agentDir: string;
}

export interface ProjectResourceLoaderResult {
  resourceLoader: ResourceLoader;
  settingsManager: SettingsManager;
}

/**
 * Resolve the global Extensions container into Pi entry paths.
 *
 * Pi's ResourceLoader accepts explicit extension entry points, but does not
 * expand a bare additional directory at load time. Keep discovery bounded to
 * Storyflow's one trusted global directory and Pi's documented one-level
 * extension layout.
 */
function discoverGlobalExtensionPaths(extensionsRoot: string): string[] {
  const paths: string[] = [];
  const entries = readdirSync(extensionsRoot, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const entryPath = join(extensionsRoot, entry.name);

    if (entry.isFile() && /\.(?:ts|js)$/.test(entry.name)) {
      paths.push(entryPath);
      continue;
    }
    if (!entry.isDirectory()) continue;

    if (existsSync(join(entryPath, 'package.json'))) {
      paths.push(entryPath);
      continue;
    }
    for (const indexName of ['index.ts', 'index.js']) {
      const indexPath = join(entryPath, indexName);
      if (existsSync(indexPath)) {
        paths.push(indexPath);
        break;
      }
    }
  }

  return paths;
}

class StoryflowResourceLoader extends DefaultResourceLoader {
  constructor(
    options: ConstructorParameters<typeof DefaultResourceLoader>[0],
    private readonly managedResourcePaths: readonly string[],
  ) {
    super(options);
  }

  override async reload(
    options?: Parameters<DefaultResourceLoader['reload']>[0],
  ): Promise<void> {
    // Trees may change after startup. Revalidate every prompt-time reload so a
    // newly inserted symlink never reaches Pi's executable resource loaders.
    for (const resourcePath of this.managedResourcePaths) {
      assertSymlinkFreeTree(resourcePath);
    }
    await super.reload(options);
  }
}

/**
 * Build the Pi resource boundary owned by Storyflow.
 *
 * Pi's default loader discovers its own global/project resources and ancestor
 * .agents/skills directories. Storyflow disables that discovery and provides
 * only ResourceResolver-owned roots explicitly.
 */
export async function createProjectResourceLoader(
  options: ProjectResourceLoaderOptions,
): Promise<ProjectResourceLoaderResult> {
  const roots = resolveResourceRoots({
    projectRoot: options.projectRoot,
    globalRoot: options.globalRoot,
  });

  const skillPaths = roots.skills.map((root) => {
    if (root.origin === 'project') {
      return ensureProjectOwnedDirectory(root.rootPath, root.path);
    }
    mkdirSync(root.path, { recursive: true });
    return root.path;
  });
  const extensionRoots = roots.extensions.map((root) => {
    mkdirSync(root.path, { recursive: true });
    return root.path;
  });
  const extensionPaths = extensionRoots.flatMap(discoverGlobalExtensionPaths);
  const managedResourcePaths = [...skillPaths, ...extensionRoots];
  for (const resourcePath of managedResourcePaths) {
    assertSymlinkFreeTree(resourcePath);
  }

  const settingsManager = SettingsManager.inMemory({
    defaultProjectTrust: 'never',
    enableSkillCommands: true,
  });
  const resourceLoader = new StoryflowResourceLoader(
    {
      cwd: options.cwd,
      agentDir: options.agentDir,
      settingsManager,
      noSkills: true,
      noExtensions: true,
      additionalSkillPaths: skillPaths,
      additionalExtensionPaths: extensionPaths,
    },
    managedResourcePaths,
  );

  // createAgentSession() does not reload a caller-provided ResourceLoader.
  await resourceLoader.reload();

  return { resourceLoader, settingsManager };
}
