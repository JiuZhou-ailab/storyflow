// input: Pi cwd, isolated session directory, user Skills, and Storyflow resources
// output: Pi-native Skills plus explicit Storyflow Extensions
// pos: Runtime resource boundary preserving native Skill discovery and Extension isolation

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  DefaultResourceLoader,
  getAgentDir,
  SettingsManager,
  type InlineExtension,
  type ResourceLoader,
} from '@earendil-works/pi-coding-agent';

import { assertSymlinkFreeTree } from '../../shared/src/workspaces/paths.ts';
import { resolveResourceRoots } from '../../shared/src/resources/resolver.ts';

export interface ProjectResourceLoaderOptions {
  cwd: string;
  globalRoot?: string;
  agentDir: string;
  /** Internal/test override for Pi's canonical user directory. */
  userAgentDir?: string;
  extensionFactories?: InlineExtension[];
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
    // Extensions execute code. Revalidate them on every prompt-time reload.
    // Skills remain under Pi's native discovery and symlink-deduplication rules.
    for (const resourcePath of this.managedResourcePaths) {
      assertSymlinkFreeTree(resourcePath);
    }
    await super.reload(options);
  }
}

/**
 * Build the Pi resource boundary owned by Storyflow.
 *
 * Skills use Pi's complete discovery contract. Extensions remain isolated to
 * Storyflow's explicit global root because they execute code at load time.
 */
export async function createProjectResourceLoader(
  options: ProjectResourceLoaderOptions,
): Promise<ProjectResourceLoaderResult> {
  const roots = resolveResourceRoots({
    globalRoot: options.globalRoot,
  });

  mkdirSync(roots.skillsPath, { recursive: true });
  mkdirSync(roots.extensionsPath, { recursive: true });
  const userSkillsPath = join(options.userAgentDir ?? getAgentDir(), 'skills');
  const skillPaths = [userSkillsPath, roots.skillsPath]
    .filter((path, index, paths) => existsSync(path) && paths.indexOf(path) === index);
  const extensionRoots = [roots.extensionsPath];
  const extensionPaths = extensionRoots.flatMap(discoverGlobalExtensionPaths);
  const managedResourcePaths = extensionRoots;
  for (const resourcePath of managedResourcePaths) {
    assertSymlinkFreeTree(resourcePath);
  }

  const settingsManager = SettingsManager.inMemory({
    enableSkillCommands: true,
  }, { projectTrusted: true });
  const resourceLoader = new StoryflowResourceLoader(
    {
      cwd: options.cwd,
      agentDir: options.agentDir,
      settingsManager,
      noSkills: false,
      noExtensions: true,
      additionalSkillPaths: skillPaths,
      additionalExtensionPaths: extensionPaths,
      extensionFactories: options.extensionFactories,
    },
    managedResourcePaths,
  );

  // createAgentSession() does not reload a caller-provided ResourceLoader.
  await resourceLoader.reload();

  return { resourceLoader, settingsManager };
}
