#!/usr/bin/env bun
/**
 * Debug script to print the full Storyflow system prompt with annotations.
 * Shows both the static Storyflow prompt and Pi's dynamic system context.
 *
 * Run with: bun run print:system-prompt
 */

import { getSystemPrompt, getDateTimeContext, getWorkingDirectoryContext } from './system.ts';
import { formatSessionState } from '../agent/mode-manager.ts';

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
};

function printHeader(title: string, bgColor: string = colors.bgBlue) {
  const padding = ' '.repeat(Math.max(0, 78 - title.length));
  console.log(`\n${bgColor}${colors.bold} ${title}${padding} ${colors.reset}`);
}

function printSection(title: string, content: string, color: string = colors.cyan) {
  console.log('\n' + '─'.repeat(80));
  console.log(`${color}${colors.bold}▶ ${title}${colors.reset}`);
  console.log('─'.repeat(80));
  console.log(content);
}

function printAnnotation(text: string) {
  console.log(`${colors.dim}${colors.yellow}// ${text}${colors.reset}`);
}

// ============================================================
// MAIN OUTPUT
// ============================================================

console.log(`
${colors.bgMagenta}${colors.bold}                                                                                ${colors.reset}
${colors.bgMagenta}${colors.bold}                    CRAFT AGENT SYSTEM PROMPT BREAKDOWN                         ${colors.reset}
${colors.bgMagenta}${colors.bold}                                                                                ${colors.reset}
`);

// ------------------------------------------------------------
// PART 1: STATIC SYSTEM PROMPT
// ------------------------------------------------------------

printHeader('PART 1: STATIC STORYFLOW SYSTEM PROMPT');
printAnnotation('Generated per turn, but kept stable so providers can cache the prefix');
printAnnotation('Pi appends dynamic context and its Skill catalog; tool schemas travel separately');
printAnnotation('');
printAnnotation('Composed of:');
printAnnotation('  1. User Preferences (if set) - formatPreferencesForPrompt()');
printAnnotation('  2. Storyflow Environment Marker - version, platform, arch');
printAnnotation('  3. Stable Runtime Contracts - safety, sources, skills, permissions');
printAnnotation('  4. On-demand Documentation References - no inlined manuals');
printAnnotation('  5. Output Protocols & Tool Metadata');
printAnnotation('  6. Debug Mode Context (if enabled) - formatDebugModeContext()');

const systemPrompt = getSystemPrompt(
  undefined, // No pinned preferences (use current from disk)
  { enabled: false }, // Debug mode disabled for cleaner output
  '/Users/example/.craft-agent/workspaces/abc123' // Example workspace path
);

printSection('FULL STATIC SYSTEM PROMPT', systemPrompt, colors.green);

console.log(`\n${colors.bold}Static System Prompt Length: ${systemPrompt.length.toLocaleString()} characters${colors.reset}`);

// Show with debug mode enabled
const systemPromptWithDebug = getSystemPrompt(
  undefined,
  { enabled: true, logFilePath: '~/Library/Logs/@craft-agent/electron/main.log' },
  '/Users/example/.craft-agent/workspaces/abc123'
);
console.log(`${colors.dim}With debug mode: ${systemPromptWithDebug.length.toLocaleString()} characters (+${(systemPromptWithDebug.length - systemPrompt.length).toLocaleString()})${colors.reset}`);

// ------------------------------------------------------------
// PART 2: DYNAMIC SYSTEM CONTEXT
// ------------------------------------------------------------

printHeader('PART 2: DYNAMIC PI SYSTEM CONTEXT (per turn)');
printAnnotation('PromptBuilder appends these components after the stable Storyflow prompt');
printAnnotation('Pi then appends the Skill catalog through system-prompt-override');

// 1. Date/Time
printSection('1. DATE/TIME CONTEXT - getDateTimeContext()', getDateTimeContext(), colors.magenta);
printAnnotation('Added last to the dynamic system context because it changes every turn');

// 2. Session State
const sessionState = formatSessionState('260121-example-session', {
  plansFolderPath:
    '/Users/example/.craft-agent/workspaces/abc123/sessions/260121-example-session/plans',
});
printSection('2. SESSION STATE - formatSessionState()', sessionState, colors.magenta);
printAnnotation('Contains: sessionId, permissionMode, modeTransition/modeChangedBy/modeChangedAt/modeVersion (when available), plansFolderPath');

// 3. Source State (example - can't call formatSourceState without agent instance)
const exampleSourceState = `<sources>
Active: linear, github
Inactive: slack (inactive), notion (needs auth)

New:
- linear: Project and issue tracking for software teams

<source_issue source="notion">
Authentication required. Use the source_oauth_trigger tool to authenticate.
</source_issue>
</sources>`;
printSection('3. SOURCE STATE - formatSourceState() [example]', exampleSourceState, colors.magenta);
printAnnotation('Generated by CraftAgent.formatSourceState() - requires agent instance');
printAnnotation('Tracks: active sources, inactive sources, new sources (first time seen), auth issues');

// 4. Workspace Capabilities
const exampleCapabilities = `<workspace_capabilities>
local-mcp: enabled (stdio subprocess servers supported)
</workspace_capabilities>`;
printSection(
  '4. WORKSPACE CAPABILITIES - formatWorkspaceCapabilities()',
  exampleCapabilities,
  colors.magenta
);
printAnnotation('Shows whether local MCP stdio servers are enabled for the workspace');

// 5. Working Directory Context
const workingDirContext = getWorkingDirectoryContext(
  '/Users/example/projects/my-app',
  false, // Not session root
  undefined // No bash cwd mismatch
);
printSection(
  '5. WORKING DIRECTORY - getWorkingDirectoryContext()',
  workingDirContext || '(empty - no working directory)',
  colors.magenta
);
printAnnotation('Contains: working_directory path, working_directory_context explanation');
printAnnotation('Project context file discovery is appended by PromptBuilder after this block');

// 6. Workspace Structure (example)
const exampleWorkspaceStructure = `<workspace_structure root="/Users/example/projects/my-app" maxDepth="4" maxEntries="120" truncated="false">
<tree>
src/
</tree>
</workspace_structure>`;
printSection(
  '6. WORKSPACE STRUCTURE - formatWorkspaceStructure()',
  exampleWorkspaceStructure,
  colors.magenta
);
printAnnotation('Bounded file tree: depth 4, at most 120 entries');

// ------------------------------------------------------------
// PART 3: COMPLETE PI SYSTEM PROMPT STRUCTURE
// ------------------------------------------------------------

printHeader('PART 3: COMPLETE PI SYSTEM PROMPT STRUCTURE');
printAnnotation('The Pi Extension keeps Skills stable and appends volatile context last');

const completeSystemPrompt = `${systemPrompt}

<skills>
...sorted Pi Skill catalog...
</skills>

<workspace_capabilities>
local-mcp: enabled (stdio subprocess servers supported)
</workspace_capabilities>

<working_directory>/Users/example/projects/my-app</working_directory>

<working_directory_context>The user explicitly selected this as the working directory for this session.</working_directory_context>

<workspace_structure root="/Users/example/projects/my-app">
<tree>
src/
</tree>
</workspace_structure>

<sources>
Active: linear
Inactive: slack (inactive)
</sources>

${sessionState}

${getDateTimeContext()}`;

printSection('COMPLETE PI SYSTEM PROMPT (example)', completeSystemPrompt, colors.green);

// ------------------------------------------------------------
// SUMMARY
// ------------------------------------------------------------

console.log(`
${colors.bgMagenta}${colors.bold}                                                                                ${colors.reset}
${colors.bgMagenta}${colors.bold}                              SUMMARY                                           ${colors.reset}
${colors.bgMagenta}${colors.bold}                                                                                ${colors.reset}

${colors.bold}Pi Prompt Assembly:${colors.reset}
  1. getSystemPrompt()                   ${colors.dim}// Stable Storyflow contracts${colors.reset}
  2. formatSkillsForPrompt()             ${colors.dim}// Sorted Pi Skill catalog${colors.reset}
  3. PromptBuilder.buildContextParts()   ${colors.dim}// Per-turn environment state${colors.reset}
  4. request tools[]                     ${colors.dim}// Separate provider tool schemas${colors.reset}

${colors.bold}Static System Prompt Components:${colors.reset}
  1. User Preferences (if set)           ${colors.dim}// formatPreferencesForPrompt()${colors.reset}
  2. Storyflow Environment Marker        ${colors.dim}// Version, platform, arch${colors.reset}
  3. Stable Runtime Contracts             ${colors.dim}// Safety and responsibility boundaries${colors.reset}
  4. On-demand Documentation Refs         ${colors.dim}// Manuals stay out of every request${colors.reset}
  5. Output Protocols & Tool Metadata     ${colors.dim}// Storyflow renderer contracts${colors.reset}
  6. Debug Mode Context (if enabled)      ${colors.dim}// formatDebugModeContext()${colors.reset}

${colors.bold}Dynamic System Context (per turn):${colors.reset}
  1. Workspace root and capabilities     ${colors.dim}// Stable workspace identity${colors.reset}
  2. Working directory + context files   ${colors.dim}// Project scope${colors.reset}
  3. Workspace structure                 ${colors.dim}// Bounded filesystem snapshot${colors.reset}
  4. Source State                        ${colors.dim}// Connected source state${colors.reset}
  5. Session State                       ${colors.dim}// Permission and session paths${colors.reset}
  6. Date/Time Context                   ${colors.dim}// Most volatile, kept last${colors.reset}

${colors.bold}Key Files:${colors.reset}
  packages/shared/src/prompts/system.ts          ${colors.dim}// Main prompt assembly${colors.reset}
  packages/shared/src/agent/core/prompt-builder.ts ${colors.dim}// Dynamic context${colors.reset}
  packages/shared/src/agent/pi-agent.ts          ${colors.dim}// Pi request assembly${colors.reset}
  packages/pi-agent-server/src/system-prompt-override.ts ${colors.dim}// Skill catalog append${colors.reset}
  packages/shared/src/agent/mode-manager.ts      ${colors.dim}// Permission modes${colors.reset}
  packages/shared/src/config/preferences.ts      ${colors.dim}// User preferences${colors.reset}
`);
