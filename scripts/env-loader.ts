// input: Repository root and optional runtime mode
// output: Layered environment values applied without overriding explicit process env
// pos: Shared dotenv loader for local development and build scripts

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

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

function catTarget(value: string): string | null {
  const match = value.match(/^\$?\(cat\s+(.+)\)$/);
  if (!match) return null;

  let target = match[1].trim();
  if (
    (target.startsWith('"') && target.endsWith('"'))
    || (target.startsWith("'") && target.endsWith("'"))
  ) {
    target = target.slice(1, -1);
  }
  return target;
}

function resolveEnvValue(value: string, rootDir: string): string {
  const target = catTarget(value);
  if (!target) return value;

  const path = isAbsolute(target) ? target : join(rootDir, target);
  return readFileSync(path, 'utf8').trimEnd();
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
      if (env[key] === undefined) {
        env[key] = resolveEnvValue(value, options.rootDir);
        appliedKeys.push(key);
        continue;
      }

      const currentValue = env[key];
      if (currentValue !== undefined && catTarget(currentValue)) {
        env[key] = resolveEnvValue(currentValue, options.rootDir);
      }
    }
  }

  if (loadedFiles.length > 0) {
    options.log?.(`Loaded env files: ${loadedFiles.join(', ')}`);
  }

  return { loadedFiles, appliedKeys };
}
