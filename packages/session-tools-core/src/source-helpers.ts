/**
 * Session Tools Core - Source Helpers
 *
 * input: Workspace roots, global source folders, and resource slugs
 * output: Resolved Source paths and lightweight config loading helpers
 * pos: Filesystem helper layer for session tool handlers
 *
 * Utilities for loading and working with source configurations.
 * These are standalone functions that don't depend on the full
 * packages/shared infrastructure.
 */

import { existsSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SourceConfig } from './types.ts';

const CRAFT_GLOBAL_SOURCES_DIR = join(homedir(), '.craft-agent', 'sources');
const SHARED_AGENTS_SOURCES_DIR = join(homedir(), '.agents', 'sources');

/** Strip UTF-8 BOM that breaks JSON.parse */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

/**
 * Get the path to a source's directory
 */
export function getSourcePath(workspaceRootPath: string, sourceSlug: string): string {
  const workspaceSourcePath = join(workspaceRootPath, 'sources', sourceSlug);
  if (existsSync(workspaceSourcePath)) {
    return workspaceSourcePath;
  }

  const craftGlobalSourcePath = join(CRAFT_GLOBAL_SOURCES_DIR, sourceSlug);
  if (existsSync(craftGlobalSourcePath)) {
    return craftGlobalSourcePath;
  }

  const sharedGlobalSourcePath = join(SHARED_AGENTS_SOURCES_DIR, sourceSlug);
  if (existsSync(sharedGlobalSourcePath)) {
    return sharedGlobalSourcePath;
  }

  return workspaceSourcePath;
}

/**
 * Get the path to a source's config.json
 */
export function getSourceConfigPath(workspaceRootPath: string, sourceSlug: string): string {
  return join(getSourcePath(workspaceRootPath, sourceSlug), 'config.json');
}

/**
 * Get the path to a source's guide.md
 */
export function getSourceGuidePath(workspaceRootPath: string, sourceSlug: string): string {
  return join(getSourcePath(workspaceRootPath, sourceSlug), 'guide.md');
}

/**
 * Check if a source directory exists
 */
export function sourceExists(workspaceRootPath: string, sourceSlug: string): boolean {
  return existsSync(getSourcePath(workspaceRootPath, sourceSlug));
}

/**
 * Check if a source config file exists
 */
export function sourceConfigExists(workspaceRootPath: string, sourceSlug: string): boolean {
  return existsSync(getSourceConfigPath(workspaceRootPath, sourceSlug));
}

/**
 * Load a source configuration from disk.
 * Returns null if the config doesn't exist or is invalid.
 */
export function loadSourceConfig(
  workspaceRootPath: string,
  sourceSlug: string
): SourceConfig | null {
  const configPath = getSourceConfigPath(workspaceRootPath, sourceSlug);

  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(stripBom(content)) as SourceConfig;
    return config;
  } catch {
    return null;
  }
}

/**
 * List all source slugs in a workspace
 */
export function listSourceSlugs(workspaceRootPath: string): string[] {
  const slugs = new Set<string>();

  for (const sourcesDir of [
    CRAFT_GLOBAL_SOURCES_DIR,
    SHARED_AGENTS_SOURCES_DIR,
    join(workspaceRootPath, 'sources'),
  ]) {
    if (!existsSync(sourcesDir)) continue;

    try {
      const entries = readdirSync(sourcesDir);
      for (const entry of entries) {
        const entryPath = join(sourcesDir, entry);
        if (statSync(entryPath).isDirectory()) {
          slugs.add(entry);
        }
      }
    } catch {
      continue;
    }
  }

  return Array.from(slugs);
}

// ============================================================
// Session State Helpers
// ============================================================

/**
 * Read the session's workingDirectory from the persisted session.jsonl header.
 * Returns undefined if the session file doesn't exist, can't be parsed,
 * or has no workingDirectory set. Never throws.
 */
export function resolveSessionWorkingDirectory(
  workspacePath: string,
  sessionId: string
): string | undefined {
  try {
    const sessionFile = join(workspacePath, 'sessions', sessionId, 'session.jsonl');
    if (!existsSync(sessionFile)) return undefined;
    // Read first line only (header) — 8KB buffer is plenty
    const fd = openSync(sessionFile, 'r');
    try {
      const buffer = Buffer.alloc(8192);
      const bytesRead = readSync(fd, buffer, 0, 8192, 0);
      const firstLine = buffer.toString('utf-8', 0, bytesRead).split('\n')[0] ?? '';
      const header = JSON.parse(firstLine);
      return header.workingDirectory || undefined;
    } finally {
      closeSync(fd);
    }
  } catch {
    return undefined; // Never fail — caller handles missing gracefully
  }
}

/**
 * Generate a unique request ID for auth requests
 */
export function generateRequestId(prefix: string = 'req'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================
// Credential Mode Helpers
// ============================================================

import type { CredentialInputMode } from './types.ts';
export type { CredentialInputMode } from './types.ts';

/**
 * Detect the effective credential input mode based on source config and requested mode.
 *
 * Auto-upgrades to 'multi-header' when source has headerNames array, regardless of
 * what mode was explicitly requested. This ensures Datadog-like sources (with
 * headerNames: ["DD-API-KEY", "DD-APPLICATION-KEY"]) always use multi-header UI.
 *
 * @param source - Source configuration (may be null if source not found)
 * @param requestedMode - Mode explicitly requested in tool call
 * @param requestedHeaderNames - Header names explicitly provided in tool call
 * @returns Effective mode to use
 */
export function detectCredentialMode(
  source: { api?: { headerNames?: string[] }; mcp?: { headerNames?: string[] } } | null,
  requestedMode: CredentialInputMode,
  requestedHeaderNames?: string[]
): CredentialInputMode {
  // Use provided headerNames or fall back to source config (API or MCP)
  const effectiveHeaderNames = requestedHeaderNames || source?.api?.headerNames || source?.mcp?.headerNames;

  // If we have headerNames, always use multi-header mode
  if (effectiveHeaderNames && effectiveHeaderNames.length > 0) {
    return 'multi-header';
  }

  return requestedMode;
}

/**
 * Get effective header names from request args or source config.
 *
 * @param source - Source configuration
 * @param requestedHeaderNames - Header names explicitly provided in tool call
 * @returns Array of header names or undefined
 */
export function getEffectiveHeaderNames(
  source: { api?: { headerNames?: string[] }; mcp?: { headerNames?: string[] } } | null,
  requestedHeaderNames?: string[]
): string[] | undefined {
  return requestedHeaderNames || source?.api?.headerNames || source?.mcp?.headerNames;
}
