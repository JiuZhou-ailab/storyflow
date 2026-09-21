// input: Host configuration bytes and historical workspace records
// output: Compatible configuration or a typed, non-destructive read failure
// pos: Persistence read boundary; only ENOENT denotes a new installation
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { StoredConfig } from './storage.ts';
import { atomicWriteFileSync, safeJsonParse } from '../utils/files.ts';
import { expandPath } from '../utils/paths.ts';
import { CONFIG_DIR } from './paths.ts';

export class StoredConfigError extends Error {
  constructor(public readonly code: 'CONFIG_INVALID' | 'CONFIG_ACCESS', options?: ErrorOptions) {
    super(code === 'CONFIG_INVALID' ? 'Host configuration is damaged. The original has been preserved.' : 'Host configuration could not be read. Check access to the data directory.', options);
    this.name = 'StoredConfigError';
  }
}

export function parseStoredConfig(raw: string): StoredConfig {
  try {
    const value = safeJsonParse(raw);
    if (!value || typeof value !== 'object' || !Array.isArray((value as StoredConfig).workspaces)) throw new Error('Missing workspace registry');
    const config = value as StoredConfig;
    // Only historical required fields are checked here. Project identity and
    // optional fields are migrated by their existing domain readers (ADR 0021).
    for (const workspace of config.workspaces) {
      if (!workspace || typeof workspace.id !== 'string' || typeof workspace.rootPath !== 'string') throw new Error('Invalid workspace registration');
      workspace.rootPath = expandPath(workspace.rootPath);
    }
    if (!config.workspaces.some(w => w.id === config.activeWorkspaceId)) config.activeWorkspaceId = config.workspaces[0]?.id ?? null;
    config.activeSessionId ??= null;
    return config;
  } catch (cause) {
    throw new StoredConfigError('CONFIG_INVALID', { cause });
  }
}

export function readStoredConfig(path: string): StoredConfig | null {
  let raw: string;
  try { raw = readFileSync(path, 'utf8'); }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new StoredConfigError('CONFIG_ACCESS', { cause });
  }
  return parseStoredConfig(raw);
}

const BACKUP_NAME = /^config\.json\.bak-\d{4}-\d{2}-\d{2}$/;

/** Read-only candidates; restoration revalidates the selected bytes under the Host lease. */
export function listStoredConfigBackups(): string[] {
  try {
    return readdirSync(CONFIG_DIR).filter(name => {
      if (!BACKUP_NAME.test(name)) return false;
      try { return readStoredConfig(join(CONFIG_DIR, name)) !== null; } catch { return false; }
    }).sort().reverse();
  } catch { return []; }
}

/** Caller must hold the Host lease. The backup selector is a basename, never a path. */
export function restoreStoredConfigBackup(name: string): void {
  if (!BACKUP_NAME.test(name)) throw new StoredConfigError('CONFIG_INVALID');
  const candidate = readFileSync(join(CONFIG_DIR, name), 'utf8');
  parseStoredConfig(candidate);
  const path = join(CONFIG_DIR, 'config.json');
  const original = readFileSync(path);
  writeFileSync(join(CONFIG_DIR, `config.json.damaged-${Date.now()}-${randomUUID()}`), original, { flag: 'wx', mode: 0o600 });
  atomicWriteFileSync(path, candidate);
  readStoredConfig(path);
}
