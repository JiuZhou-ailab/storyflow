// input: Project cwd, Pi user paths, and the isolated Pi runtime bundle
// output: Pi-native Skill catalog projected into Storyflow's renderer contract
// pos: CJS-safe projection boundary that keeps the ESM-only Pi SDK in its runtime

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import matter from 'gray-matter';

import { resolveResourceRoots } from '../resources/resolver.ts';
import { findIconFile } from '../utils/icon.ts';
import { getPiUserSkillsDir, parseSkillFile } from './storage.ts';
import type { LoadedSkill, SkillCatalog } from './types.ts';

export interface LoadPiSkillCatalogOptions {
  agentDir?: string;
  additionalSkillPaths?: string[];
}

interface PiCatalogSkill {
  name: string;
  description: string;
  baseDir: string;
  filePath: string;
  sourceInfo: {
    scope: LoadedSkill['scope'];
    source: string;
    origin: LoadedSkill['origin'];
  };
}

interface PiCatalogResult {
  skills: PiCatalogSkill[];
  diagnostics: SkillCatalog['diagnostics'];
}

/**
 * Keep Storyflow's former global directory readable during the compatibility
 * window. Pi still performs parsing, validation, deduplication, and precedence.
 */
export function getStoryflowAdditionalSkillPaths(
  agentDir = dirname(getPiUserSkillsDir()),
): string[] {
  const nativeUserSkills = resolve(getPiUserSkillsDir());
  const loaderUserSkills = resolve(agentDir, 'skills');
  const legacySkills = resolve(resolveResourceRoots().skillsPath);

  return [nativeUserSkills, legacySkills]
    .filter((path, index, paths) => (
      path !== loaderUserSkills
      && existsSync(path)
      && paths.indexOf(path) === index
    ));
}

function projectSkill(skill: PiCatalogSkill): LoadedSkill {
  const raw = readFileSync(skill.filePath, 'utf-8');
  const document = matter(raw);
  const parsed = parseSkillFile(raw);
  const displayName = document.data?.metadata?.displayName;

  return {
    slug: skill.name,
    metadata: {
      ...(parsed?.metadata ?? {
        name: skill.name,
        description: skill.description,
      }),
      name: skill.name,
      description: skill.description,
      displayName: typeof displayName === 'string'
        ? displayName
        : parsed?.metadata.displayName,
    },
    content: document.content,
    iconPath: findIconFile(skill.baseDir),
    path: skill.baseDir,
    filePath: skill.filePath,
    scope: skill.sourceInfo.scope,
    source: skill.sourceInfo.source,
    origin: skill.sourceInfo.origin,
  };
}

function getBundledPiServerPath(): string | undefined {
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE;
  if (!resourcesBase) return undefined;

  const candidate = join(resourcesBase, 'resources', 'pi-agent-server', 'index.js');
  return existsSync(candidate) ? candidate : undefined;
}

function loadCatalogFromPiSubprocess(cwd: string, piServerPath: string): Promise<PiCatalogResult> {
  const bunRuntime = process.env.CRAFT_BUN || 'bun';

  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      bunRuntime,
      [piServerPath, '--skill-catalog', cwd],
      { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          rejectPromise(new Error(
            `Pi Skill catalog subprocess failed: ${stderr.trim() || error.message}`,
          ));
          return;
        }

        try {
          const output = stdout.trim().split(/\r?\n/).at(-1);
          const catalog = JSON.parse(output || '') as PiCatalogResult;
          if (!Array.isArray(catalog.skills) || !Array.isArray(catalog.diagnostics)) {
            throw new Error('invalid catalog payload');
          }
          resolvePromise(catalog);
        } catch (parseError) {
          rejectPromise(new Error(
            `Pi Skill catalog returned invalid JSON: ${
              parseError instanceof Error ? parseError.message : String(parseError)
            }`,
          ));
        }
      },
    );
  });
}

async function loadCatalogInProcess(
  cwd: string,
  options: LoadPiSkillCatalogOptions,
): Promise<PiCatalogResult> {
  // Keep the specifier computed: Electron's CJS bundle must not inline Pi's
  // ESM-only config module. Bun/headless runtimes can load it natively.
  const piPackageName = ['@earendil-works', 'pi-coding-agent'].join('/');
  const {
    DefaultResourceLoader,
    SettingsManager,
    getAgentDir,
  } = await import(piPackageName) as typeof import('@earendil-works/pi-coding-agent');

  const agentDir = options.agentDir ?? getAgentDir();
  const settingsManager = SettingsManager.inMemory(
    { enableSkillCommands: true },
    { projectTrusted: true },
  );
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    additionalSkillPaths: options.additionalSkillPaths
      ?? getStoryflowAdditionalSkillPaths(agentDir),
  });
  await resourceLoader.reload();
  return resourceLoader.getSkills() as PiCatalogResult;
}

/** Load exactly the catalog Pi would expose for this project. */
export async function loadPiSkillCatalog(
  cwd: string,
  options: LoadPiSkillCatalogOptions = {},
): Promise<SkillCatalog> {
  const piServerPath = Object.keys(options).length === 0
    ? getBundledPiServerPath()
    : undefined;
  const catalog = piServerPath
    ? await loadCatalogFromPiSubprocess(cwd, piServerPath)
    : await loadCatalogInProcess(cwd, options);
  const skills: LoadedSkill[] = [];
  const diagnostics = [...catalog.diagnostics];
  for (const skill of catalog.skills) {
    try {
      skills.push(projectSkill(skill));
    } catch (error) {
      diagnostics.push({
        type: 'warning',
        message: error instanceof Error ? error.message : 'failed to project Skill',
        path: skill.filePath,
      });
    }
  }
  return {
    skills,
    diagnostics,
  };
}
