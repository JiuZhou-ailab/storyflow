// input: user-authored global Markdown profile stored in the Craft Agent config directory
// output: path helpers and prompt formatting for user-level identity and preferences
// pos: human-readable user context layer alongside structured preferences

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { CONFIG_DIR } from './paths.ts';
import { ensureConfigDir } from './storage.ts';

const USER_PROFILE_FILE = join(CONFIG_DIR, 'USER.md');
const MAX_USER_PROFILE_PROMPT_CHARS = 20 * 1024;

export function getUserProfilePath(): string {
  return USER_PROFILE_FILE;
}

export function loadUserProfileMarkdown(): string {
  try {
    if (!existsSync(USER_PROFILE_FILE)) {
      return '';
    }
    return readFileSync(USER_PROFILE_FILE, 'utf-8');
  } catch {
    return '';
  }
}

export function saveUserProfileMarkdown(content: string): void {
  ensureConfigDir();
  writeFileSync(USER_PROFILE_FILE, content, 'utf-8');
}

export function formatUserProfileForPrompt(): string {
  const content = loadUserProfileMarkdown().trim();
  if (!content) {
    return '';
  }

  const clippedContent = content.length > MAX_USER_PROFILE_PROMPT_CHARS
    ? `${content.slice(0, MAX_USER_PROFILE_PROMPT_CHARS)}\n\n... (truncated)`
    : content;

  return [
    '## User Profile',
    '',
    'The following Markdown is written by the user and describes their identity, long-term preferences, thoughts, and collaboration style. Treat it as user-level defaults. Project instructions, Method Pack contracts, and explicit user requests override it when they conflict.',
    '',
    clippedContent,
    '',
  ].join('\n');
}
