// input: Current cwd, bounded Pi user resources, Storyflow product prompt, and a diagnostic turn
// output: Safe snapshots of the stable system prompt and transient per-turn model context
// pos: Read-only prompt diagnostics that reuse the production composition boundary

import { resolve } from 'node:path';

import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';

import { PromptBuilder } from '../../shared/src/agent/core/prompt-builder.ts';
import { getPiAgentDir } from '../../shared/src/config/pi-user-paths.ts';
import { getSystemPrompt } from '../../shared/src/prompts/system.ts';
import {
  createBoundedAgentsFilesOverride,
  createSkillCatalogResourceLoader,
} from './project-resource-loader.ts';
import { createSystemPromptOverride } from './system-prompt-override.ts';

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
  agentsFilesOverride: createBoundedAgentsFilesOverride({ cwd, agentDir }),
  systemPromptOverride: promptController.overrideResourcePrompt,
});
await resourceLoader.reload();

const modelRuntime = await ModelRuntime.create({ modelsPath: null });
const { session } = await createAgentSession({
  cwd,
  agentDir,
  modelRuntime,
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
  const turnProjection = promptBuilder.buildTurnContext({
    plansFolderPath: `${cwd}/.craft-agent/prompt-snapshot/plans`,
    dataFolderPath: `${cwd}/.craft-agent/prompt-snapshot/data`,
  });
  const turnPolicy = turnProjection.system.join('\n\n');
  const turnContext = turnProjection.data.join('\n\n');
  const stablePrompt = session.systemPrompt;

  console.log('STORYFLOW MODEL CONTEXT SNAPSHOT');
  console.log(`cwd: ${cwd}`);
  console.log(`agentDir: ${agentDir}`);
  console.log(`productPromptChars: ${productPrompt.length}`);
  console.log(`stableSystemPromptChars: ${stablePrompt.length}`);
  console.log(`transientTurnPolicyChars: ${turnPolicy.length}`);
  console.log(`transientTurnDataChars: ${turnContext.length}`);
  console.log(`stablePlusTransientChars: ${stablePrompt.length + turnPolicy.length + turnContext.length}`);
  console.log(`skills: ${resourceLoader.getSkills().skills.length}`);
  console.log('note: active-session Source state and executable Extension mutations are omitted');
  console.log('\n--- STABLE SYSTEM PROMPT ---\n');
  console.log(stablePrompt);
  console.log('\n--- TRANSIENT SYSTEM POLICY ---\n');
  console.log(turnPolicy);
  console.log('\n--- TRANSIENT TURN DATA ---\n');
  console.log(turnContext);
} finally {
  session.dispose();
}
