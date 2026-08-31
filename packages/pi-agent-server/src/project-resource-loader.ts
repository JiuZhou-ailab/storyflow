// input: Pi cwd, project boundary, agent directory, and legacy Skills
// output: Pi ResourceLoader with Storyflow-specific context boundary and skill compatibility
// pos: Minimal product adapter over Pi's public ResourceLoader options

import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  DefaultResourceLoader,
  SettingsManager,
  type InlineExtension,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";

import { resolveResourceRoots } from "../../shared/src/resources/resolver.ts";

export const DEFAULT_PI_PACKAGE_SOURCES = [] as const;

// ponytail: one-time migration shipped in 0.18.x; delete after two client releases
// (>= 0.20.0) once installed clients no longer carry this package in settings.
const DISABLED_PI_PACKAGE_SOURCES = new Set(["npm:@ayulab/pi-rewind"]);

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
  ConstructorParameters<typeof DefaultResourceLoader>[0]["agentsFilesOverride"]
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
  return (
    pathFromRoot === "" ||
    (pathFromRoot !== ".." &&
      !pathFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromRoot))
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
    if (existsSync(join(candidate, ".git"))) return candidate;
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
  return (base) => ({
    agentsFiles: base.agentsFiles.filter((file) => {
      const path = canonicalPath(file.path);
      return isWithinPath(agentDir, path) || isWithinPath(contextRoot, path);
    }),
  });
}

async function seedDefaultPiPackages(
  settingsManager: SettingsManager,
): Promise<void> {
  if (process.env.CRAFT_BUN && !settingsManager.getNpmCommand()?.length) {
    settingsManager.setNpmCommand(["bun"]);
  }

  const packages = settingsManager.getPackages();
  const kept = packages.filter((entry) => {
    const source = typeof entry === "string" ? entry : entry.source;
    return !DISABLED_PI_PACKAGE_SOURCES.has(source);
  });
  if (kept.length !== packages.length) {
    settingsManager.setPackages(kept);
    await settingsManager.flush();
  }
}

/**
 * Build the Pi resource boundary owned by Storyflow.
 *
 * Pi owns resource discovery, project trust, and package settings. Storyflow
 * contributes only its legacy Skill directory, context boundary, and product
 * inline Extensions via public DefaultResourceLoader options.
 */
export async function createProjectResourceLoader(
  options: ProjectResourceLoaderOptions,
): Promise<ProjectResourceLoaderResult> {
  const roots = resolveResourceRoots({
    globalRoot: options.globalRoot,
  });

  const skillPaths = [roots.skillsPath].filter(
    (path, index, paths) => existsSync(path) && paths.indexOf(path) === index,
  );

  const settingsManager = SettingsManager.create(
    options.cwd,
    options.agentDir,
    { projectTrusted: false },
  );
  await seedDefaultPiPackages(settingsManager);

  // Skills come from a project-trusted loader so project-scoped Skill packages
  // (non-executable resources) are discoverable without granting project trust
  // to Extensions (executable code). Pi's single project-trust switch cannot
  // express this split, so the second loader is load-bearing (ADR 0018).
  const skillSettingsManager = SettingsManager.create(
    options.cwd,
    options.agentDir,
    { projectTrusted: true },
  );
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

  // Wrap reload so the skill loader stays in sync and product overrides are
  // applied after each Pi-internal reload without subclassing.
  const inner = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager,
    additionalSkillPaths: skillPaths,
    extensionFactories: options.extensionFactories,
    skillsOverride: () => skillLoader.getSkills(),
    agentsFilesOverride: createBoundedAgentsFilesOverride(options),
    systemPromptOverride: options.systemPromptOverride,
  });

  const resourceLoader: ResourceLoader = {
    async reload(reloadOptions?): Promise<void> {
      await skillLoader.reload();
      await inner.reload(reloadOptions);
      settingsManager.applyOverrides({
        enableSkillCommands: true,
        compaction: { enabled: true },
      });
    },
    getExtensions: () => inner.getExtensions(),
    getSkills: () => inner.getSkills(),
    getPrompts: () => inner.getPrompts(),
    getThemes: () => inner.getThemes(),
    getAgentsFiles: () => inner.getAgentsFiles(),
    getSystemPrompt: () => inner.getSystemPrompt(),
    getSystemPromptSource: () => inner.getSystemPromptSource(),
    getAppendSystemPrompt: () => inner.getAppendSystemPrompt(),
    getAppendSystemPromptSources: () => inner.getAppendSystemPromptSources(),
    extendResources: (paths) => inner.extendResources(paths),
  };

  // createAgentSession() does not reload a caller-provided ResourceLoader.
  await resourceLoader.reload();

  return { resourceLoader, settingsManager };
}

export async function createSkillCatalogResourceLoader(
  options: Pick<
    ProjectResourceLoaderOptions,
    "cwd" | "globalRoot" | "agentDir"
  >,
): Promise<ResourceLoader> {
  const roots = resolveResourceRoots({ globalRoot: options.globalRoot });
  const compatibilitySkillPaths = existsSync(roots.skillsPath)
    ? [roots.skillsPath]
    : [];
  const settingsManager = SettingsManager.create(
    options.cwd,
    options.agentDir,
    {
      projectTrusted: true,
    },
  );
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
