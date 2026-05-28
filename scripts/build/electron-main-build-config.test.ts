// input: Electron main process build entrypoints
// output: Regression coverage for dependencies that must stay external
// pos: Protects runtime-sensitive Electron main build configuration

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateDesktopAuthBuildEnv } from './desktop-auth-build-config';

const rootDir = join(import.meta.dir, '..', '..');
const CLAUDE_AGENT_SDK_EXTERNAL = '@anthropic-ai/claude-agent-sdk';
const CLAUDE_AGENT_SDK_EXTERNAL_ARG = '--external:@anthropic-ai/claude-agent-sdk';

function readRepoFile(path: string): string {
  return readFileSync(join(rootDir, path), 'utf8');
}

describe('Electron main process build config', () => {
  test('keeps Claude Agent SDK external in the shared main build path', () => {
    expect(readRepoFile('scripts/electron-build-main.ts')).toContain(CLAUDE_AGENT_SDK_EXTERNAL_ARG);
  });

  test('delegates package build entrypoints to the shared auth-aware main build', () => {
    const checkedFiles = [
      'scripts/build/win32.ts',
      'apps/electron/package.json',
      'apps/electron/scripts/build-win.ps1',
    ];

    for (const file of checkedFiles) {
      expect(readRepoFile(file), file).toContain('electron:build:main');
    }
  });

  test('keeps Claude Agent SDK external in dev esbuild config', () => {
    expect(readRepoFile('scripts/electron-dev.ts')).toContain(CLAUDE_AGENT_SDK_EXTERNAL);
  });
});

describe('desktop auth build config', () => {
  test('allows builds when desktop client auth is disabled', () => {
    expect(validateDesktopAuthBuildEnv({})).toEqual({ ok: true });
  });

  test('allows localhost brokers only for explicit dev-runtime builds', () => {
    expect(validateDesktopAuthBuildEnv({
      CRAFT_DEV_RUNTIME: '1',
      CRAFT_CLIENT_AUTH_REQUIRED: 'true',
      CRAFT_CLIENT_AUTH_BROKER_URL: 'http://localhost:9100',
    })).toEqual({ ok: true });
  });

  test('requires a broker for packaged desktop client auth', () => {
    expect(validateDesktopAuthBuildEnv({
      CRAFT_CLIENT_AUTH_REQUIRED: 'true',
      CRAFT_CLIENT_NEON_AUTH_BASE_URL: 'https://auth.example.com',
    })).toEqual({
      ok: false,
      message: 'CRAFT_CLIENT_AUTH_BROKER_URL is required for packaged desktop client auth.',
    });
  });

  test('rejects localhost brokers for packaged desktop client auth', () => {
    const result = validateDesktopAuthBuildEnv({
      CRAFT_CLIENT_AUTH_REQUIRED: 'true',
      CRAFT_CLIENT_AUTH_BROKER_URL: 'http://localhost:9100',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('localhost broker');
    }
  });

  test('requires https broker URLs for packaged desktop client auth', () => {
    expect(validateDesktopAuthBuildEnv({
      CRAFT_CLIENT_AUTH_REQUIRED: 'true',
      CRAFT_CLIENT_AUTH_BROKER_URL: 'http://auth.storyflow.example.com',
    })).toEqual({
      ok: false,
      message: 'CRAFT_CLIENT_AUTH_BROKER_URL must use https for packaged desktop client auth.',
    });
  });

  test('accepts deployed HTTPS brokers for packaged desktop client auth', () => {
    expect(validateDesktopAuthBuildEnv({
      CRAFT_CLIENT_AUTH_REQUIRED: 'true',
      CRAFT_CLIENT_AUTH_BROKER_URL: ' https://auth.storyflow.example.com/ ',
    })).toEqual({ ok: true });
  });
});
