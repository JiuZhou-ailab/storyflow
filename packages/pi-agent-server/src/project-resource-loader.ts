// input: Current Storyflow project root, Pi session cwd, and isolated agent directory
// output: Reloaded Pi resource loader restricted to the project's canonical Skills directory
// pos: Security boundary preventing Pi from discovering global or shared-agent resources

import {
  DefaultResourceLoader,
  SettingsManager,
  type ResourceLoader,
} from '@earendil-works/pi-coding-agent';

import {
  assertSymlinkFreeTree,
  ensureProjectOwnedDirectory,
  getWorkspaceSkillsPath,
} from '../../shared/src/workspaces/paths.ts';

export interface ProjectResourceLoaderOptions {
  cwd: string;
  projectRoot: string;
  agentDir: string;
}

export interface ProjectResourceLoaderResult {
  resourceLoader: ResourceLoader;
  settingsManager: SettingsManager;
}

class ProjectResourceLoader extends DefaultResourceLoader {
  constructor(
    options: ConstructorParameters<typeof DefaultResourceLoader>[0],
    private readonly projectSkillsPath: string,
  ) {
    super(options);
  }

  override async reload(
    options?: Parameters<DefaultResourceLoader['reload']>[0],
  ): Promise<void> {
    // The tree may change after session startup. Revalidate at every prompt-time
    // reload so a newly inserted symlink never reaches Pi's filesystem loader.
    assertSymlinkFreeTree(this.projectSkillsPath);
    await super.reload(options);
  }
}

/**
 * Build the Pi resource boundary owned by Storyflow.
 *
 * Pi's default loader also discovers ~/.agents/skills and ancestor
 * .agents/skills directories. Storyflow Skills are intentionally project-only,
 * so default discovery is disabled and the canonical project path is added
 * explicitly.
 */
export async function createProjectResourceLoader(
  options: ProjectResourceLoaderOptions,
): Promise<ProjectResourceLoaderResult> {
  const projectSkillsPath = ensureProjectOwnedDirectory(
    options.projectRoot,
    getWorkspaceSkillsPath(options.projectRoot),
  );
  assertSymlinkFreeTree(projectSkillsPath);
  const settingsManager = SettingsManager.inMemory({
    defaultProjectTrust: 'never',
    enableSkillCommands: true,
  });
  const resourceLoader = new ProjectResourceLoader(
    {
      cwd: options.cwd,
      agentDir: options.agentDir,
      settingsManager,
      noSkills: true,
      noExtensions: true,
      // Keep one stable project path registered for every reload.
      additionalSkillPaths: [projectSkillsPath],
    },
    projectSkillsPath,
  );

  // createAgentSession() does not reload a caller-provided ResourceLoader.
  await resourceLoader.reload();

  return { resourceLoader, settingsManager };
}
