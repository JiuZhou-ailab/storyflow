// input: app configuration, workspace metadata, and prompt profile options
// output: system prompt strings for Storyflow runtime contexts
// pos: central prompt composition module for agent sessions

import { formatPreferencesForPrompt, getCoAuthorPreference } from '../config/preferences.ts';
import { getBrowserToolEnabled } from '../config/storage.ts';
import { debug } from '../utils/debug.ts';
import { globSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'path';
import { DOC_REFS } from '../docs/index.ts';
import { PERMISSION_MODE_CONFIG } from '../agent/mode-types.ts';
import { FEATURE_FLAGS } from '../feature-flags.ts';
import { WORKSPACE_STATE_DIR } from '../workspaces/paths.ts';
import { formatLanguagePolicyForPrompt } from '../i18n/language-policy.ts';

/** Maximum size of CLAUDE.md file to include (10KB) */
const MAX_CONTEXT_FILE_SIZE = 10 * 1024;

/** Maximum number of context files to discover in monorepo */
const MAX_CONTEXT_FILES = 30;

/**
 * Directories to exclude when searching for context files.
 * These are common build output, dependency, and cache directories.
 */
const EXCLUDED_DIRECTORIES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  'vendor',
  '.cache',
  '.turbo',
  'out',
  '.output',
];

/**
 * Context file patterns to look for in working directory (in priority order).
 * Matching is case-insensitive to support AGENTS.md, Agents.md, agents.md, etc.
 */
const CONTEXT_FILE_PATTERNS = ['agents.md', 'claude.md'];

/**
 * Find a file in directory matching the pattern case-insensitively.
 * Returns the actual filename if found, null otherwise.
 */
function findFileCaseInsensitive(directory: string, pattern: string): string | null {
  try {
    const files = readdirSync(directory);
    const lowerPattern = pattern.toLowerCase();
    return files.find((f) => f.toLowerCase() === lowerPattern) ?? null;
  } catch {
    return null;
  }
}

function findStateContextFiles(directory: string): string[] {
  const stateDir = join(directory, WORKSPACE_STATE_DIR);
  const files: string[] = [];
  for (const pattern of CONTEXT_FILE_PATTERNS) {
    const actualFilename = findFileCaseInsensitive(stateDir, pattern);
    if (actualFilename) {
      files.push(join(WORKSPACE_STATE_DIR, actualFilename));
    }
  }
  return files;
}

function normalizeContextPath(file: string): string {
  return file.replaceAll('\\', '/');
}

/**
 * Find a project context file (AGENTS.md or CLAUDE.md) in the directory.
 * Just checks if file exists, doesn't read content.
 * Returns the actual filename if found, null otherwise.
 */
export function findProjectContextFile(directory: string): string | null {
  for (const pattern of CONTEXT_FILE_PATTERNS) {
    const actualFilename = findFileCaseInsensitive(directory, pattern);
    if (actualFilename) {
      debug(`[findProjectContextFile] Found ${actualFilename}`);
      return actualFilename;
    }
  }
  return null;
}

// ── Context file cache ──────────────────────────────────────────────────
// The glob walk is expensive (~7s in large monorepos). The result (a list of
// file paths like "CLAUDE.md", "apps/electron/CLAUDE.md") rarely changes during
// a session, so we cache it per working directory with a 5-minute safety TTL.
// Explicit invalidation happens on working directory changes.

const contextFileCache = new Map<string, { files: string[]; ts: number }>();
const CONTEXT_FILE_CACHE_TTL = 5 * 60_000; // 5 minutes

/** Invalidate the cached context file list for a directory (or all directories). */
export function invalidateContextFileCache(directory?: string): void {
  if (directory) {
    contextFileCache.delete(directory);
    debug(`[contextFileCache] Invalidated cache for ${directory}`);
  } else {
    contextFileCache.clear();
    debug(`[contextFileCache] Cleared all cached entries`);
  }
}

/**
 * Find all project context files (AGENTS.md or CLAUDE.md) recursively in a directory.
 * Supports monorepo setups where each package may have its own context file.
 * Returns relative paths sorted by depth (root first), capped at MAX_CONTEXT_FILES.
 *
 * Results are cached per directory. Call invalidateContextFileCache() on working
 * directory changes. A 5-minute TTL acts as a safety net for cache staleness.
 */
export function findAllProjectContextFiles(directory: string): string[] {
  // Check cache first
  const now = Date.now();
  const cached = contextFileCache.get(directory);
  if (cached && now - cached.ts < CONTEXT_FILE_CACHE_TTL) {
    debug(`[findAllProjectContextFiles] Cache hit for ${directory} (${cached.files.length} files)`);
    return cached.files;
  }

  try {
    // Build glob ignore patterns from excluded directories
    const ignorePatterns = EXCLUDED_DIRECTORIES.map((dir) => `**/${dir}/**`);

    const matches = globSync('**/*.{md,MD,Md,mD}', {
      cwd: directory,
      exclude: ignorePatterns,
    }).map(normalizeContextPath).filter((file) => /(?:^|[\\/])(?:agents|claude)\.md$/i.test(file));
    const stateMatches = findStateContextFiles(directory).map(normalizeContextPath);
    const allMatches = Array.from(new Set([...stateMatches, ...matches]));

    if (allMatches.length === 0) {
      contextFileCache.set(directory, { files: [], ts: now });
      return [];
    }

    // Sort by depth (fewer slashes = shallower = higher priority), then alphabetically
    // Root files come first, then nested packages
    const sorted = allMatches.sort((a, b) => {
      const depthA = (a.match(/\//g) || []).length;
      const depthB = (b.match(/\//g) || []).length;
      if (depthA !== depthB) return depthA - depthB;
      return a.localeCompare(b);
    });

    // Cap at max files to avoid overwhelming the prompt
    const capped = sorted.slice(0, MAX_CONTEXT_FILES);

    debug(`[findAllProjectContextFiles] Found ${allMatches.length} files, returning ${capped.length}`);
    contextFileCache.set(directory, { files: capped, ts: now });
    return capped;
  } catch (error) {
    debug(`[findAllProjectContextFiles] Error searching directory:`, error);
    return [];
  }
}

/**
 * Read the project context file (AGENTS.md or CLAUDE.md) from a directory.
 * Matching is case-insensitive to support any casing (CLAUDE.md, claude.md, Claude.md, etc.).
 * Returns the content if found, null otherwise.
 */
export function readProjectContextFile(directory: string): { filename: string; content: string } | null {
  for (const pattern of CONTEXT_FILE_PATTERNS) {
    // Find the actual filename with case-insensitive matching
    const actualFilename = findFileCaseInsensitive(directory, pattern);
    if (!actualFilename) continue;

    const filePath = join(directory, actualFilename);
    try {
      const content = readFileSync(filePath, 'utf-8');
      // Cap at max size to avoid huge prompts
      if (content.length > MAX_CONTEXT_FILE_SIZE) {
        debug(`[readProjectContextFile] ${actualFilename} exceeds max size, truncating`);
        return {
          filename: actualFilename,
          content: content.slice(0, MAX_CONTEXT_FILE_SIZE) + '\n\n... (truncated)',
        };
      }
      debug(`[readProjectContextFile] Found ${actualFilename} (${content.length} chars)`);
      return { filename: actualFilename, content };
    } catch (error) {
      debug(`[readProjectContextFile] Error reading ${actualFilename}:`, error);
      // Continue to next pattern
    }
  }
  const stateDir = join(directory, WORKSPACE_STATE_DIR);
  for (const pattern of CONTEXT_FILE_PATTERNS) {
    const actualFilename = findFileCaseInsensitive(stateDir, pattern);
    if (!actualFilename) continue;

    const filePath = join(stateDir, actualFilename);
    try {
      const content = readFileSync(filePath, 'utf-8');
      const filename = join(WORKSPACE_STATE_DIR, actualFilename);
      if (content.length > MAX_CONTEXT_FILE_SIZE) {
        debug(`[readProjectContextFile] ${filename} exceeds max size, truncating`);
        return {
          filename,
          content: content.slice(0, MAX_CONTEXT_FILE_SIZE) + '\n\n... (truncated)',
        };
      }
      debug(`[readProjectContextFile] Found ${filename} (${content.length} chars)`);
      return { filename, content };
    } catch (error) {
      debug(`[readProjectContextFile] Error reading ${actualFilename}:`, error);
    }
  }
  return null;
}

/**
 * Get the working directory context string for injection into user messages.
 * Includes the working directory path and context about what it represents.
 * Returns empty string if no working directory is set.
 *
 * Note: Project context files (CLAUDE.md, AGENTS.md) are listed in PromptBuilder's
 * per-turn system context so filesystem changes do not invalidate the stable prefix.
 *
 * @param workingDirectory - The effective working directory path (where user wants to work)
 * @param isSessionRoot - If true, this is the session folder (not a user-specified project)
 */
export function getWorkingDirectoryContext(
  workingDirectory?: string,
  isSessionRoot?: boolean,
): string {
  if (!workingDirectory) {
    return '';
  }

  const parts: string[] = [];
  parts.push(`<working_directory>${workingDirectory}</working_directory>`);

  if (isSessionRoot) {
    // Add context explaining this is the session folder, not a code project
    parts.push(`<working_directory_context>
This is the session's root folder (default). It contains session files (conversation history, plans, attachments) - not a code repository.
You can access any files the user attaches here. If the user wants to work with a code project, they can set a working directory via the UI or provide files directly.
</working_directory_context>`);
  } else {
    parts.push(`<working_directory_context>The user explicitly selected this as the working directory for this session.</working_directory_context>`);
  }

  return parts.join('\n\n');
}

/**
 * Get the current date/time context string
 */
export function getDateTimeContext(): string {
  const now = new Date();
  const formatted = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  return `**USER'S DATE AND TIME: ${formatted}** - ALWAYS use this as the authoritative current date/time. Ignore any other date information.`;
}

/** Debug mode configuration for system prompt */
export interface DebugModeConfig {
  enabled: boolean;
  logFilePath?: string;
}

/**
 * Get the project context files prompt section for per-turn system context.
 * Lists all discovered context files (AGENTS.md, CLAUDE.md) in the working directory.
 * For monorepos, this includes nested package context files.
 * Returns empty string if no working directory or no context files found.
 */
export function getProjectContextFilesPrompt(workingDirectory?: string): string {
  if (!workingDirectory) {
    return '';
  }

  const contextFiles = findAllProjectContextFiles(workingDirectory);
  if (contextFiles.length === 0) {
    return '';
  }

  // Format file list with (root) annotation for top-level files
  const fileList = contextFiles
    .map((file) => {
      const isRoot = !file.includes('/');
      return `- ${file}${isRoot ? ' (root)' : ''}`;
    })
    .join('\n');

  return `
<project_context_files working_directory="${workingDirectory}">
${fileList}
</project_context_files>`;
}

/** Options for getSystemPrompt */
export interface SystemPromptOptions {
  pinnedPreferencesPrompt?: string;
  debugMode?: DebugModeConfig;
  workspaceRootPath?: string;
  /** Working directory for context file discovery (monorepo support) */
  workingDirectory?: string;
  /** @deprecated Runtime infrastructure is intentionally not model-visible. */
  backendName?: string;
}

/**
 * System prompt preset types for different agent contexts.
 * - 'default': Full Storyflow system prompt
 * - 'mini': Focused prompt for quick configuration edits
 * - 'novel': Full Storyflow prompt plus novel writing workspace rules
 */
export type SystemPromptPreset = 'default' | 'mini' | 'novel';

/**
 * Get a focused system prompt for mini agents (quick edit tasks).
 * Optimized for configuration edits with minimal context.
 *
 * @param workspaceRootPath - Root path of the workspace for config file locations
 */
export function getMiniAgentSystemPrompt(
  workspaceRootPath?: string,
  language?: string,
): string {
  const workspaceContext = workspaceRootPath
    ? `\n## Workspace\nConfig files are in: \`${workspaceRootPath}/.craft-agent\`\n- Statuses: \`.craft-agent/statuses/config.json\`\n- Labels: \`.craft-agent/labels/config.json\`\n- Permissions: \`permissions.json\`\n`
    : '';

  return `You are a focused assistant for quick configuration edits in Storyflow.

## Your Role
You help users make targeted changes to configuration files. Be concise and efficient.
${formatLanguagePolicyForPrompt(language)}
${workspaceContext}
## Guidelines
- Make the requested change directly
- Validate with config_validate after editing
- Confirm completion briefly
- Don't add unrequested features or changes
- Keep responses short and to the point
- For math, use $$...$$ delimiters; avoid single $...$ in prose so currency remains plain text

## Available Tools
Use Read, Edit, Write tools for file operations.
Use config_validate to verify changes match the expected schema.
`;
}

/**
 * Get additional guidance for novel writing workspaces.
 */
function getNovelWritingSystemPrompt(): string {
  return `

## Novel Writing Workspace

Treat novel projects as long-form creative work where manuscript fidelity and continuity matter.

- preserve manuscript prose: Do not rewrite, summarize, normalize, or reorganize draft text unless the user explicitly asks for that prose change.
- Treat the bible as canon for characters, locations, world rules, terminology, voice, and other durable story facts.
- Treat story files as manuscript or planning material based on their location and metadata; do not collapse drafting and planning concerns into one category.
- Treat state and timeline files as continuity records. Keep them consistent with manuscript events and update them when drafting changes continuity.
- Before drafting or revising, read the relevant bible, outline, current state, and timeline files so new prose fits canon and sequence.
- Group changes by manuscript, outline, characters, locations, state, timeline, and working notes so creative text, planning, and continuity records stay easy to review.
- Prefer relevant Skills for novel-specific workflows before inventing ad hoc processes.
- Do not draft directly from a broad first writing request. First use a relevant Skill when available, extract known constraints, and ask only for missing decisions that materially change the story.
- For prompts like "write a story" or "写一个...", clarify method-defining dimensions before outline or prose: audience lane, genre promise, protagonist/relationship setup, emotional engine, reversal rhythm, ending/payoff, and length or chapter target.
`;
}

/**
 * Get the stable system prompt with user preferences
 *
 * Note: Safe Mode context is injected via user messages instead of system prompt
 * to preserve prompt caching.
 *
 * @param pinnedPreferencesPrompt - Pre-formatted preferences (for session consistency)
 * @param debugMode - Debug mode configuration
 * @param workspaceRootPath - Root path of the workspace
 * @param _workingDirectory - Retained for positional API compatibility; context discovery is per-turn
 * @param preset - System prompt preset ('default' | 'mini' | custom string)
 * @param _backendName - Deprecated compatibility argument; intentionally ignored
 * @param language - Optional selected language override, primarily useful for tests and isolated runtimes
 */
export function getSystemPrompt(
  pinnedPreferencesPrompt?: string,
  debugMode?: DebugModeConfig,
  workspaceRootPath?: string,
  _workingDirectory?: string,
  preset?: SystemPromptPreset | string,
  _backendName?: string,
  includeCoAuthoredBy?: boolean,
  language?: string,
): string {
  // Use mini agent prompt for quick edits (pass workspace root for config paths)
  if (preset === 'mini') {
    debug('[getSystemPrompt] 🤖 Generating MINI agent system prompt for workspace:', workspaceRootPath);
    return getMiniAgentSystemPrompt(workspaceRootPath, language);
  }

  // Use pinned preferences if provided (for session consistency after compaction)
  const preferences = pinnedPreferencesPrompt ?? formatPreferencesForPrompt();
  const debugContext = debugMode?.enabled ? formatDebugModeContext(debugMode.logFilePath) : '';

  // Fall back to the user's current preference when callers don't pin/pass a value,
  // so forgetting the argument can't silently re-enable the co-author trailer (see #576).
  const resolvedIncludeCoAuthoredBy = includeCoAuthoredBy ?? getCoAuthorPreference();

  // Note: Date/time context is now added to user messages instead of system prompt
  // to enable prompt caching. The system prompt stays static and cacheable.
  // Safe Mode context is also in user messages for the same reason.
  const basePrompt = getStoryflowAssistantPrompt(resolvedIncludeCoAuthoredBy, language);
  const presetPrompt = preset === 'novel' ? getNovelWritingSystemPrompt() : '';
  const fullPrompt = `${basePrompt}${presetPrompt}${preferences}${debugContext}`;

  debug('[getSystemPrompt] full prompt length:', fullPrompt.length);

  return fullPrompt;
}

/**
 * Format debug mode context for the system prompt.
 * Only included when running in development mode.
 */
function formatDebugModeContext(logFilePath?: string): string {
  if (!logFilePath) {
    return '';
  }

  return `

## Debug Mode

You are running in **debug mode** (development build). Application logs are available for analysis.

### Log Access

- **Log file:** \`${logFilePath}\`
- **Format:** JSON Lines (one JSON object per line)

Each log entry has this structure:
\`\`\`json
{"timestamp":"2025-01-04T10:30:00.000Z","level":"info","scope":"session","message":["Log message here"]}
\`\`\`

### Querying Logs

Use Bash with \`rg\`/\`grep\` to search logs efficiently:

\`\`\`bash
# Search by scope (session, ipc, window, agent, main)
rg -n "session" "${logFilePath}"

# Search by level (error, warn, info)
rg -n '"level":"error"' "${logFilePath}"

# Search for specific keywords
rg -n "OAuth" "${logFilePath}"

# Recent matches (tail)
rg -n "session|OAuth|\"level\":\"error\"" "${logFilePath}" | tail -n 50
\`\`\`

**Tip:** Use \`-C 2\` for context around matches when debugging issues.
`;
}

/**
 * Get the stable Storyflow product system prompt.
 *
 * This prompt is intentionally concise - detailed documentation lives in
 * ${APP_ROOT}/docs/ and is read on-demand when topics come up.
 *
 * @param includeCoAuthoredBy - Whether to include the Co-Authored-By git trailer instruction (default: true)
 */
function getStoryflowAssistantPrompt(
  includeCoAuthoredBy: boolean = true,
  language?: string,
): string {
  const browserToolsSection = getBrowserToolEnabled() ? `
## Browser Tools

Before the first \`browser_tool\` call in a session, read \`${DOC_REFS.browserTools}\`. Use the browser for authenticated, dynamic, UI-only, or one-off tasks; prefer Sources for repeatable integrations. Start with \`browser_tool --help\`, use \`snapshot\` refs for interaction, refresh refs after navigation, and use \`close\`, \`release\`, or \`hide\` when done.
` : '';

  return `You are Storyflow - an AI assistant for working across connected sources, local files, code, and repeatable workflows. Refer to yourself as Storyflow when asked.

${formatLanguagePolicyForPrompt(language)}

## Runtime Contracts

- Storyflow is the product identity. Treat provider, runtime, and compatibility-path names as implementation details, not as the assistant's identity.
- Be concise, show brief progress for multi-step work, and use only tools that are actually available.
- Confirm destructive actions before deleting content.
- Present local paths and URLs as clickable Markdown links.
- Use \`$$...$$\` for math; do not use single-dollar math delimiters in prose.
- User preferences can be stored with \`update_user_preferences\`; offer to save durable personal preferences when useful.

## Sources, Skills, and Project Context

- Existing Sources live under the workspace root at \`.craft-agent/sources/{slug}/\`. Read that source's \`config.json\` and \`guide.md\` before first use; do not rediscover configured schemas elsewhere.
- Before creating or modifying a Source, read \`${DOC_REFS.sources}\`. Prefer Sources for repeatable integrations and automation.
- Skills are instructions, not tools. Pi resolves user Skills from \`~/.pi/agent/skills\` and \`~/.agents/skills\`, plus project Skills from \`.pi/skills\` and \`.agents/skills\`. Read every active Skill's resolved \`SKILL.md\` before acting.
- When \`<project_context_files>\` is present, read the relevant root and package-level \`CLAUDE.md\` or \`AGENTS.md\` before changing that scope.
- Do not guess Storyflow schemas. Read the relevant on-demand guide first:
  - permissions: \`${DOC_REFS.permissions}\`
  - Skills: \`${DOC_REFS.skills}\`
  - automations: \`${DOC_REFS.hooks}\`
  - themes: \`${DOC_REFS.themes}\`
  - statuses: \`${DOC_REFS.statuses}\`
  - labels: \`${DOC_REFS.labels}\`
  - tool icons: \`${DOC_REFS.toolIcons}\`
  - Mermaid: \`${DOC_REFS.mermaid}\`
  - data tables: \`${DOC_REFS.dataTables}\`
  - HTML/PDF/image preview: \`${DOC_REFS.htmlPreview}\`, \`${DOC_REFS.pdfPreview}\`, \`${DOC_REFS.imagePreview}\`
  - LLM tool: \`${DOC_REFS.llmTool}\`
${FEATURE_FLAGS.craftAgentsCli ? `- Prefer the \`craft-agent\` CLI for labels, Sources, Skills, and automations; read \`${DOC_REFS.craftCli}\` or the relevant \`--help\` before mutation.
` : ''}
${includeCoAuthoredBy ? `## Git Conventions

When creating git commits, include:

\`\`\`
Co-Authored-By: Storyflow <agents-noreply@craft.do>
\`\`\`
` : ''}## Permission Modes

- **${PERMISSION_MODE_CONFIG['safe'].displayName}**: read-only exploration; only plans and scratch data may be written.
- **${PERMISSION_MODE_CONFIG['ask'].displayName}**: read freely and request approval before edits.
- **${PERMISSION_MODE_CONFIG['allow-all'].displayName}**: autonomous execution.

Treat the latest \`<session_state>\` as authoritative. \`plansFolderPath\` is the exact location for implementation plans. \`dataFolderPath\` is for scratch or intermediate tool output; it is not the destination for user-requested project files. Durable deliverables belong in the current working directory and must follow the visible project structure.

In Explore mode, use \`SubmitPlan\` only when the plan is ready for approval. Do not ask the user to switch modes. When execution is authorized, write durable project deliverables to the current working directory; never redirect them to session data merely because that path is writable.

## Web Search

Use the built-in \`web_search\` tool as the default for routine web search, current facts, and documentation. Storyflow owns provider authentication and routing; never request or persist a provider API key. Use browser tools for authentication or dynamic UI state.

## Output and Preview Protocols

- Use small Markdown tables for simple data. For 20+ rows, read \`${DOC_REFS.dataTables}\` and use \`datatable\` or \`spreadsheet\`; keep large rows file-backed with an absolute \`src\`.
- Use Mermaid for relationships or flows and validate complex diagrams with \`mermaid_validate\`.
- Use \`html-preview\`, \`pdf-preview\`, or \`image-preview\` fenced blocks with an absolute \`src\`. Use \`items\` for tabbed variants and read the matching guide before rendering.
- Prefer a Source's \`render_template\` when its \`guide.md\` declares a template.
- Built-in document CLIs available through Bash are \`markitdown\`, \`pdf-tool\`, \`xlsx-tool\`, \`docx-tool\`, \`pptx-tool\`, \`img-tool\`, \`doc-diff\`, and \`ical-tool\`; use \`--help\` for syntax.

## LLM Tool (\`call_llm\`)

Use \`call_llm\` only for focused, context-isolated text or structured extraction where a separate completion is useful. It has no conversation history. If a subtask needs files or shell tools, \`call_llm\` cannot use them; handle it with the current agent. Read \`${DOC_REFS.llmTool}\` before advanced use.
${browserToolsSection}
## Session Self-Management

Use \`get_session_info\` for one session and filtered \`list_sessions\` for discovery. Use \`set_session_labels\` and \`set_session_status\` only when the user request or workflow requires the corresponding mutation; these changes may trigger automations.

${FEATURE_FLAGS.developerFeedback ? `
## Developer Feedback

Use \`send_developer_feedback\` for reproducible Storyflow product issues or concrete improvement ideas, not one-off user errors.
` : ''}`;
}
