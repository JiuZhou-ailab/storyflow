// input: Layered dotenv files and explicit process environment
// output: Regression coverage for env file precedence
// pos: Protects local/dev/build environment loading from release-time drift

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvFiles, parseDotenv } from '../env-loader';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'storyflow-env-loader-'));
}

describe('parseDotenv', () => {
  test('parses simple quoted and unquoted values without evaluating shell code', () => {
    expect(parseDotenv([
      '# comment',
      'PLAIN=value',
      'QUOTED="hello world"',
      "SINGLE='hello again'",
      'CAT=$(cat /secret)',
      'BROKEN',
    ].join('\n'))).toEqual({
      PLAIN: 'value',
      QUOTED: 'hello world',
      SINGLE: 'hello again',
      CAT: '$(cat /secret)',
    });
  });
});

describe('loadEnvFiles', () => {
  test('keeps explicit environment values above all dotenv files', () => {
    const rootDir = tempDir();
    writeFileSync(join(rootDir, '.env.local'), 'KEY=local\n');
    writeFileSync(join(rootDir, '.env.dev'), 'KEY=dev\n');
    writeFileSync(join(rootDir, '.env'), 'KEY=base\n');
    const env: NodeJS.ProcessEnv = { KEY: 'explicit' };

    loadEnvFiles({ rootDir, mode: 'dev', env });

    expect(env.KEY).toBe('explicit');
  });

  test('uses local overrides before dev and base files in dev mode', () => {
    const rootDir = tempDir();
    writeFileSync(join(rootDir, '.env'), 'KEY=base\nBASE_ONLY=base\n');
    writeFileSync(join(rootDir, '.env.dev'), 'KEY=dev\nDEV_ONLY=dev\n');
    writeFileSync(join(rootDir, '.env.local'), 'KEY=local\nLOCAL_ONLY=local\n');
    const env: NodeJS.ProcessEnv = {};

    const result = loadEnvFiles({ rootDir, mode: 'dev', env });

    expect(result.loadedFiles).toEqual(['.env.local', '.env.dev', '.env']);
    expect(env.KEY).toBe('local');
    expect(env.LOCAL_ONLY).toBe('local');
    expect(env.DEV_ONLY).toBe('dev');
    expect(env.BASE_ONLY).toBe('base');
  });

  test('does not load dev-only files for build mode', () => {
    const rootDir = tempDir();
    writeFileSync(join(rootDir, '.env'), 'BASE_ONLY=base\n');
    writeFileSync(join(rootDir, '.env.dev'), 'DEV_ONLY=dev\n');
    const env: NodeJS.ProcessEnv = {};

    const result = loadEnvFiles({ rootDir, mode: 'build', env });

    expect(result.loadedFiles).toEqual(['.env']);
    expect(env.BASE_ONLY).toBe('base');
    expect(env.DEV_ONLY).toBeUndefined();
  });
});
