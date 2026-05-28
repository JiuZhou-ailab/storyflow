// input: Repository root and optional runtime mode
// output: Layered environment values applied without overriding explicit process env
// pos: Shared dotenv loader for local development and build scripts

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface EnvLoadOptions {
  rootDir: string;
  mode?: 'dev' | 'build';
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
}

export interface EnvLoadResult {
  loadedFiles: string[];
  appliedKeys: string[];
}

export function parseDotenv(content: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (!key) continue;

    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

export function loadEnvFiles(options: EnvLoadOptions): EnvLoadResult {
  const env = options.env ?? process.env;
  const candidates = options.mode === 'dev'
    ? ['.env.local', '.env.dev', '.env']
    : ['.env.local', '.env'];
  const loadedFiles: string[] = [];
  const appliedKeys: string[] = [];

  for (const fileName of candidates) {
    const filePath = join(options.rootDir, fileName);
    if (!existsSync(filePath)) continue;

    loadedFiles.push(fileName);
    const values = parseDotenv(readFileSync(filePath, 'utf8'));
    for (const [key, value] of Object.entries(values)) {
      if (env[key] !== undefined) continue;
      env[key] = value;
      appliedKeys.push(key);
    }
  }

  if (loadedFiles.length > 0) {
    options.log?.(`Loaded env files: ${loadedFiles.join(', ')}`);
  }

  return { loadedFiles, appliedKeys };
}
