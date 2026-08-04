// input: Pi cwd, canonical Pi agent directory, bundled Bun runtime, and legacy Storyflow resources
// output: Pi-native resources plus compatibility paths and Storyflow inline Extensions
// pos: Thin product adapter over Pi's ResourceLoader and package ecosystem

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  DefaultPackageManager,
  DefaultResourceLoader,
  SettingsManager,
  type InlineExtension,
  type ResourceDiagnostic,
  type ResourceLoader,
} from '@earendil-works/pi-coding-agent';

import { assertSymlinkFreeTree } from '../../shared/src/workspaces/paths.ts';
import { resolveResourceRoots } from '../../shared/src/resources/resolver.ts';

export const DEFAULT_PI_PACKAGE_SOURCES = [
  'npm:@ayulab/pi-rewind',
] as const;

export interface ProjectResourceLoaderOptions {
  cwd: string;
  globalRoot?: string;
  agentDir: string;
  extensionFactories?: InlineExtension[];
}

export interface ProjectResourceLoaderResult {
  resourceLoader: ResourceLoader;
  settingsManager: SettingsManager;
}

class ReadOnlySkillCatalogLoader extends DefaultResourceLoader {
  private readonly packageSettingsManager: SettingsManager;
  private readonly readOnlyPackageManager: DefaultPackageManager;

  constructor(
    options: Pick<ProjectResourceLoaderOptions, 'cwd' | 'agentDir'>,
    private readonly compatibilitySkillPaths: readonly string[],
  ) {
    super({
      cwd: options.cwd,
      agentDir: options.agentDir,
      settingsManager: SettingsManager.inMemory({}, { projectTrusted: true }),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    this.packageSettingsManager = SettingsManager.create(options.cwd, options.agentDir, {
      projectTrusted: true,
    });
    this.readOnlyPackageManager = new DefaultPackageManager({
      cwd: options.cwd,
      agentDir: options.agentDir,
      settingsManager: this.packageSettingsManager,
    });
  }

  override async reload(): Promise<void> {
    await this.packageSettingsManager.reload();
    const resolved = await this.readOnlyPackageManager.resolve(async () => 'skip');
    await super.reload();

    const enabledSkills = resolved.skills.filter(resource => resource.enabled);
    const projectSkills = enabledSkills.filter(resource => resource.metadata.scope === 'project');
    const remainingSkills = enabledSkills.filter(resource => resource.metadata.scope !== 'project');
    this.extendResources({
      skillPaths: [
        ...projectSkills,
        ...remainingSkills,
        ...this.compatibilitySkillPaths.map(path => ({
          path,
          metadata: {
            source: 'storyflow-compatibility',
            scope: 'temporary' as const,
            origin: 'top-level' as const,
            baseDir: path,
          },
        })),
      ],
    });
  }
}

export function createStoryflowRetrySettings() {
  return {
    enabled: true,
    maxRetries: 1,
    baseDelayMs: 2_000,
    provider: { maxRetries: 0 },
  };
}

function diagnosticKey(diagnostic: ResourceDiagnostic): string {
  return JSON.stringify([
    diagnostic.type,
    diagnostic.message,
    diagnostic.path,
    diagnostic.collision?.resourceType,
    diagnostic.collision?.name,
    diagnostic.collision?.winnerPath,
    diagnostic.collision?.loserPath,
    diagnostic.collision?.winnerSource,
    diagnostic.collision?.loserSource,
  ]);
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

  for (const source of DEFAULT_PI_PACKAGE_SOURCES) {
    changed = packageManager.addSourceToSettings(source) || changed;
  }
  if (changed) await settingsManager.flush();
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
    private readonly projectSkillLoader: DefaultResourceLoader,
    private readonly runtimeSettingsManager: SettingsManager,
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
    await this.projectSkillLoader.reload();
    await super.reload(options);
    this.runtimeSettingsManager.applyOverrides({
      enableSkillCommands: true,
      retry: createStoryflowRetrySettings(),
    });
  }
}

/**
 * Build the Pi resource boundary owned by Storyflow.
 *
 * Pi owns resource discovery and package settings. Storyflow contributes only
 * its legacy resource directories and product-specific inline Extensions.
 */
export async function createProjectResourceLoader(
  options: ProjectResourceLoaderOptions,
): Promise<ProjectResourceLoaderResult> {
  const roots = resolveResourceRoots({
    globalRoot: options.globalRoot,
  });

  const skillPaths = [roots.skillsPath]
    .filter((path, index, paths) => existsSync(path) && paths.indexOf(path) === index);
  const extensionRoots = [roots.extensionsPath].filter(existsSync);
  const extensionPaths = extensionRoots.flatMap(discoverGlobalExtensionPaths);
  const managedResourcePaths = extensionRoots;
  for (const resourcePath of managedResourcePaths) {
    assertSymlinkFreeTree(resourcePath);
  }

  // Skills are declarative content, so project Skills remain discoverable without
  // granting project-local executable Extensions the same trust.
  const projectSkillLoader = new ReadOnlySkillCatalogLoader(options, skillPaths);

  const settingsManager = SettingsManager.create(options.cwd, options.agentDir, {
    projectTrusted: false,
  });
  await seedDefaultPiPackages(options.cwd, options.agentDir, settingsManager);
  const resourceLoader = new StoryflowResourceLoader(
    {
      cwd: options.cwd,
      agentDir: options.agentDir,
      settingsManager,
      noSkills: false,
      additionalSkillPaths: skillPaths,
      additionalExtensionPaths: extensionPaths,
      extensionFactories: options.extensionFactories,
      skillsOverride(base) {
        const projectCatalog = projectSkillLoader.getSkills();
        const projectSkills = projectCatalog.skills.filter(
          skill => skill.sourceInfo.scope === 'project',
        );
        const projectNames = new Set(projectSkills.map(skill => skill.name));
        const diagnostics = new Map(
          [...base.diagnostics, ...projectCatalog.diagnostics]
            .map(diagnostic => [diagnosticKey(diagnostic), diagnostic]),
        );
        return {
          skills: [
            ...projectSkills,
            ...base.skills.filter(skill => !projectNames.has(skill.name)),
          ],
          diagnostics: [...diagnostics.values()],
        };
      },
    },
    managedResourcePaths,
    projectSkillLoader,
    settingsManager,
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
  const resourceLoader = new ReadOnlySkillCatalogLoader(options, compatibilitySkillPaths);
  await resourceLoader.reload();
  return resourceLoader;
}
