// input: Temporary Pi agent directories and Markdown system instructions
// output: Regression coverage for canonical AGENTS.md persistence
// pos: Contract test for user-level system instruction storage

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getSystemInstructionsPath,
  loadSystemInstructionsMarkdown,
  MAX_SYSTEM_INSTRUCTIONS_CHARS,
  saveSystemInstructionsMarkdown,
} from './system-instructions.ts';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('system instructions', () => {
  it('uses the Pi-native AGENTS.md filename', () => {
    expect(getSystemInstructionsPath('/tmp/pi-agent')).toBe('/tmp/pi-agent/AGENTS.md');
  });

  it('returns empty content before the user creates instructions', () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'storyflow-system-instructions-'));
    tempDirs.push(agentDir);

    expect(loadSystemInstructionsMarkdown(agentDir)).toBe('');
  });

  it('persists Markdown without transforming user content', () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'storyflow-system-instructions-'));
    tempDirs.push(agentDir);
    const content = '# Collaboration\n\n- Reply in Chinese.\n';

    saveSystemInstructionsMarkdown(content, agentDir);

    expect(readFileSync(getSystemInstructionsPath(agentDir), 'utf-8')).toBe(content);
    expect(loadSystemInstructionsMarkdown(agentDir)).toBe(content);
  });

  it('rejects oversized instructions without replacing the last valid document', () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'storyflow-system-instructions-'));
    tempDirs.push(agentDir);
    saveSystemInstructionsMarkdown('keep this', agentDir);

    expect(() => saveSystemInstructionsMarkdown(
      'x'.repeat(MAX_SYSTEM_INSTRUCTIONS_CHARS + 1),
      agentDir,
    )).toThrow(`System instructions cannot exceed ${MAX_SYSTEM_INSTRUCTIONS_CHARS} characters`);
    expect(loadSystemInstructionsMarkdown(agentDir)).toBe('keep this');
  });
});
