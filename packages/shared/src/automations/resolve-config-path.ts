/**
 * Automations Config Path Resolver
 */

import { randomBytes } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AUTOMATIONS_CONFIG_FILE } from './constants.ts';
import {
  isPathWithinProjectRoot,
  resolveProjectOwnedPath,
  UnsafeProjectPathError,
} from '../workspaces/paths.ts';

/**
 * Generate a short 6-character hex ID for matcher identification.
 * Uses crypto.randomBytes for uniqueness (24 bits of entropy = 16M possibilities).
 */
export function generateShortId(): string {
  return randomBytes(3).toString('hex');
}

/**
 * Resolve the automations config path for a workspace.
 */
export function resolveAutomationsConfigPath(workspaceRoot: string): string {
  return join(workspaceRoot, AUTOMATIONS_CONFIG_FILE);
}

/** Validate an Automation file without following a Project-internal symlink. */
export function resolveAutomationOwnedPath(workspaceRoot: string, targetPath: string): string {
  const lexicalPath = resolve(targetPath);
  if (!isPathWithinProjectRoot(workspaceRoot, lexicalPath, { allowMissing: true })) {
    throw new UnsafeProjectPathError(
      `Project automation path contains a symbolic link or escapes the Project: ${lexicalPath}`,
    );
  }
  try {
    lstatSync(lexicalPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return lexicalPath;
    throw error;
  }
  return resolveProjectOwnedPath(workspaceRoot, lexicalPath);
}
