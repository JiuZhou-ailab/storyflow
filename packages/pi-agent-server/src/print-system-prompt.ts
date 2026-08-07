// input: Current cwd, Pi user resources, Storyflow product prompt, and a diagnostic turn
// output: Safe snapshot of the Pi-native stable prompt and effective per-turn prompt
// pos: Read-only prompt diagnostics that reuse the production composition boundary

import { resolve } from 'node:path';

import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';

import { PromptBuilder } from '../../shared/src/agent/core/prompt-builder.ts';
import { getPiAgentDir } from '../../shared/src/config/pi-user-paths.ts';
import { getSystemPrompt } from '../../shared/src/prompts/system.ts';
import { createSkillCatalogResourceLoader } from './project-resource-loader.ts';
import {
  buildEffectiveSystemPrompt,
  createSystemPromptOverride,
} from './system-prompt-override.ts';

const cwd = resolve(process.argv[2] ?? process.cwd());
const agentDir = getPiAgentDir();
const now = Date.now();
const sessionId = 'prompt-snapshot';

const productPrompt = getSystemPrompt(
  undefined,
  { enabled: false },
  cwd,
  cwd,
);
const promptController = createSystemPromptOverride();
promptController.set(productPrompt);

// Reuse Pi's real resource discovery while intentionally disabling executable
// Extensions. A diagnostic command must not execute arbitrary user code.
const skillLoader = await createSkillCatalogResourceLoader({ cwd, agentDir });
const settingsManager = SettingsManager.create(cwd, agentDir, {
  projectTrusted: false,
});
const resourceLoader = new DefaultResourceLoader({
  cwd,
  agentDir,
  settingsManager,
  noExtensions: true,
  noPromptTemplates: true,
  noThemes: true,
  skillsOverride: () => skillLoader.getSkills(),
  systemPromptOverride: promptController.overrideResourcePrompt,
});
await resourceLoader.reload();

const authStorage = AuthStorage.inMemory();
const modelRegistry = ModelRegistry.inMemory(authStorage);
const { session } = await createAgentSession({
  cwd,
  agentDir,
  authStorage,
  modelRegistry,
  resourceLoader,
  settingsManager,
  sessionManager: SessionManager.inMemory(cwd),
  tools: ['read'],
});

try {
  const promptBuilder = new PromptBuilder({
    workspace: {
      id: 'prompt-snapshot',
      name: 'Prompt snapshot',
      slug: 'prompt-snapshot',
      rootPath: cwd,
      createdAt: now,
      lastAccessedAt: now,
    },
    session: {
      id: sessionId,
      workspaceRootPath: cwd,
      workingDirectory: cwd,
      createdAt: now,
      lastUsedAt: now,
    },
  });
  const dynamicPrompt = promptBuilder.buildContextParts({
    plansFolderPath: `${cwd}/.craft-agent/prompt-snapshot/plans`,
    dataFolderPath: `${cwd}/.craft-agent/prompt-snapshot/data`,
  }).join('\n\n');
  const stablePrompt = session.systemPrompt;
  const effectivePrompt = buildEffectiveSystemPrompt(stablePrompt, dynamicPrompt);

  console.log('STORYFLOW EFFECTIVE SYSTEM PROMPT SNAPSHOT');
  console.log(`cwd: ${cwd}`);
  console.log(`agentDir: ${agentDir}`);
  console.log(`productPromptChars: ${productPrompt.length}`);
  console.log(`piStablePromptChars: ${stablePrompt.length}`);
  console.log(`dynamicPromptChars: ${dynamicPrompt.length}`);
  console.log(`effectivePromptChars: ${effectivePrompt.length}`);
  console.log(`skills: ${resourceLoader.getSkills().skills.length}`);
  console.log('note: active-session Source state and executable Extension mutations are omitted');
  console.log('\n--- EFFECTIVE PROMPT ---\n');
  console.log(effectivePrompt);
} finally {
  session.dispose();
}
