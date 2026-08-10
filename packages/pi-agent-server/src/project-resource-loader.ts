// input: Pi cwd, project context boundary, canonical agent directory, bundled runtime, and legacy Skills
// output: Bounded Pi-native instructions plus legacy Skill compatibility and Storyflow inline Extensions
// pos: Thin product policy adapter over Pi's ResourceLoader and package ecosystem

import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  DefaultPackageManager,
  DefaultResourceLoader,
  SettingsManager,
  type InlineExtension,
  type ResourceLoader,
} from '@earendil-works/pi-coding-agent';

import { resolveResourceRoots } from '../../shared/src/resources/resolver.ts';

export const DEFAULT_PI_PACKAGE_SOURCES = [] as const;

const DISABLED_PI_PACKAGE_SOURCES = [
  'npm:@ayulab/pi-rewind',
] as const;

export interface ProjectResourceLoaderOptions {
  cwd: string;
  contextRoot?: string;
  globalRoot?: string;
  agentDir: string;
  extensionFactories?: InlineExtension[];
  systemPromptOverride?: (base: string | undefined) => string | undefined;
}

export interface ProjectResourceLoaderResult {
  resourceLoader: ResourceLoader;
  settingsManager: SettingsManager;
}

type AgentsFilesOverride = NonNullable<
  ConstructorParameters<typeof DefaultResourceLoader>[0]['agentsFilesOverride']
>;

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function isWithinPath(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === '' || (
    pathFromRoot !== '..'
    && !pathFromRoot.startsWith(`..${sep}`)
    && !isAbsolute(pathFromRoot)
  );
}

function resolveContextRoot(cwd: string, explicitRoot?: string): string {
  const canonicalCwd = canonicalPath(cwd);
  if (explicitRoot) {
    const canonicalExplicitRoot = canonicalPath(explicitRoot);
    if (isWithinPath(canonicalExplicitRoot, canonicalCwd)) {
      return canonicalExplicitRoot;
    }
  }

  let candidate = canonicalCwd;
  while (true) {
    if (existsSync(join(candidate, '.git'))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) return canonicalCwd;
    candidate = parent;
  }
}

/** Keep explicit user-global instructions and project instructions, never arbitrary filesystem ancestors. */
export function createBoundedAgentsFilesOverride(options: {
  cwd: string;
  agentDir: string;
  contextRoot?: string;
}): AgentsFilesOverride {
  const agentDir = canonicalPath(options.agentDir);
  const contextRoot = resolveContextRoot(options.cwd, options.contextRoot);
  return base => ({
    agentsFiles: base.agentsFiles.filter(file => {
      const path = canonicalPath(file.path);
      return isWithinPath(agentDir, path) || isWithinPath(contextRoot, path);
    }),
  });
}

async function seedDefaultPiPackages(
  cwd: string,
  agentDir: string,
  settingsManager: SettingsManager,
): Promise<void> {
  if (process.env.CRAFT_BUN && !settingsManager.getNpmCommand()?.length) {
    settingsManager.setNpmCommand(['bun']);
  }

  const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
  let changed = false;

  for (const source of DISABLED_PI_PACKAGE_SOURCES) {
    changed = packageManager.removeSourceFromSettings(source) || changed;
  }
  for (const source of DEFAULT_PI_PACKAGE_SOURCES) {
    changed = packageManager.addSourceToSettings(source) || changed;
  }
  if (changed) await settingsManager.flush();
}

class StoryflowResourceLoader extends DefaultResourceLoader {
  constructor(
    options: ConstructorParameters<typeof DefaultResourceLoader>[0],
    private readonly runtimeSettingsManager: SettingsManager,
    private readonly skillLoader: DefaultResourceLoader,
  ) {
    super(options);
  }

  override async reload(
    options?: Parameters<DefaultResourceLoader['reload']>[0],
  ): Promise<void> {
    await this.skillLoader.reload();
    await super.reload(options);
    this.runtimeSettingsManager.applyOverrides({
      enableSkillCommands: true,
    });
  }
}

/**
 * Build the Pi resource boundary owned by Storyflow.
 *
 * Pi owns resource discovery, project trust, and package settings. Storyflow
 * contributes only its legacy Skill directory and product-specific inline
 * Extensions.
 */
export async function createProjectResourceLoader(
  options: ProjectResourceLoaderOptions,
): Promise<ProjectResourceLoaderResult> {
  const roots = resolveResourceRoots({
    globalRoot: options.globalRoot,
  });

  const skillPaths = [roots.skillsPath]
    .filter((path, index, paths) => existsSync(path) && paths.indexOf(path) === index);

  const settingsManager = SettingsManager.create(options.cwd, options.agentDir, {
    projectTrusted: false,
  });
  const skillSettingsManager = SettingsManager.create(options.cwd, options.agentDir, {
    projectTrusted: true,
  });
  await seedDefaultPiPackages(options.cwd, options.agentDir, settingsManager);
  const skillLoader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager: skillSettingsManager,
    noExtensions: true,
    additionalSkillPaths: skillPaths,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  const resourceLoader = new StoryflowResourceLoader(
    {
      cwd: options.cwd,
      agentDir: options.agentDir,
      settingsManager,
      noSkills: false,
      additionalSkillPaths: skillPaths,
      extensionFactories: options.extensionFactories,
      skillsOverride: () => skillLoader.getSkills(),
      agentsFilesOverride: createBoundedAgentsFilesOverride(options),
      systemPromptOverride: options.systemPromptOverride,
    },
    settingsManager,
    skillLoader,
  );

  // createAgentSession() does not reload a caller-provided ResourceLoader.
  await resourceLoader.reload();

  return { resourceLoader, settingsManager };
}

export async function createSkillCatalogResourceLoader(
  options: Pick<ProjectResourceLoaderOptions, 'cwd' | 'globalRoot' | 'agentDir'>,
): Promise<ResourceLoader> {
  const roots = resolveResourceRoots({ globalRoot: options.globalRoot });
  const compatibilitySkillPaths = existsSync(roots.skillsPath) ? [roots.skillsPath] : [];
  const settingsManager = SettingsManager.create(options.cwd, options.agentDir, {
    projectTrusted: true,
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager,
    noExtensions: true,
    additionalSkillPaths: compatibilitySkillPaths,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();
  return resourceLoader;
}
