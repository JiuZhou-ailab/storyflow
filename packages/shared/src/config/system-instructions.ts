// input: User-authored Markdown and the canonical Pi user configuration directory
// output: Read/write helpers for Pi's user-level AGENTS.md context file
// pos: Persistence boundary for the Settings page's "System instructions" field

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFileSync } from '../utils/files.ts';
import { getPiAgentDir } from './pi-user-paths.ts';
import { MAX_SYSTEM_INSTRUCTIONS_CHARS } from './system-instructions-contract.ts';

export { MAX_SYSTEM_INSTRUCTIONS_CHARS } from './system-instructions-contract.ts';

export function getSystemInstructionsPath(agentDir = getPiAgentDir()): string {
  return join(agentDir, 'AGENTS.md');
}

export function loadSystemInstructionsMarkdown(agentDir = getPiAgentDir()): string {
  const path = getSystemInstructionsPath(agentDir);
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf-8');
}

export function saveSystemInstructionsMarkdown(
  content: string,
  agentDir = getPiAgentDir(),
): void {
  if (content.length > MAX_SYSTEM_INSTRUCTIONS_CHARS) {
    throw new RangeError(
      `System instructions cannot exceed ${MAX_SYSTEM_INSTRUCTIONS_CHARS} characters`,
    );
  }
  mkdirSync(agentDir, { recursive: true });
  atomicWriteFileSync(getSystemInstructionsPath(agentDir), content);
}
