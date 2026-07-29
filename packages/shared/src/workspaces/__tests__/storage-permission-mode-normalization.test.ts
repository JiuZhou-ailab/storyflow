import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadWorkspaceConfig, saveWorkspaceConfig } from '../storage.ts';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors in tests
    }
  }
});

describe('workspace storage: config normalization', () => {
  it('writes workspace config under .craft-agent while keeping legacy root reads', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'ws-hidden-config-'));
    tempDirs.push(workspaceRoot);

    const config = {
      id: 'ws_hidden',
      name: 'Hidden Config',
      slug: 'hidden-config',
      defaults: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    saveWorkspaceConfig(workspaceRoot, config);

    expect(existsSync(join(workspaceRoot, 'config.json'))).toBe(false);
    expect(existsSync(join(workspaceRoot, '.craft-agent', 'config.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(workspaceRoot, '.craft-agent', 'config.json'), 'utf-8')).name).toBe('Hidden Config');

    const legacyRoot = mkdtempSync(join(tmpdir(), 'ws-legacy-config-'));
    tempDirs.push(legacyRoot);
    writeFileSync(join(legacyRoot, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
    expect(loadWorkspaceConfig(legacyRoot)?.name).toBe('Hidden Config');
  });

  it('maps canonical defaults.permissionMode and cyclablePermissionModes on read', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'ws-mode-map-'));
    tempDirs.push(workspaceRoot);

    const rawConfig = {
      id: 'ws_123',
      name: 'Test Workspace',
      slug: 'test-workspace',
      defaults: {
        permissionMode: 'explore',
        cyclablePermissionModes: ['explore', 'ask', 'execute'],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    writeFileSync(join(workspaceRoot, 'config.json'), JSON.stringify(rawConfig, null, 2), 'utf-8');

    const loaded = loadWorkspaceConfig(workspaceRoot);
    expect(loaded).not.toBeNull();
    expect(loaded?.defaults?.permissionMode).toBe('ask');
    expect(loaded?.defaults?.cyclablePermissionModes).toEqual(['ask', 'allow-all']);
  });

  it('falls back to full cycle if persisted cyclablePermissionModes are invalid', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'ws-mode-invalid-'));
    tempDirs.push(workspaceRoot);

    const rawConfig = {
      id: 'ws_456',
      name: 'Broken Modes',
      slug: 'broken-modes',
      defaults: {
        permissionMode: 'execute',
        cyclablePermissionModes: ['unknown'],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    writeFileSync(join(workspaceRoot, 'config.json'), JSON.stringify(rawConfig, null, 2), 'utf-8');

    const loaded = loadWorkspaceConfig(workspaceRoot);
    expect(loaded).not.toBeNull();
    expect(loaded?.defaults?.permissionMode).toBe('allow-all');
    expect(loaded?.defaults?.cyclablePermissionModes).toEqual(['ask', 'allow-all']);
  });

  it('normalizes legacy defaults.thinkingLevel=think on read', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'ws-thinking-legacy-'));
    tempDirs.push(workspaceRoot);

    const rawConfig = {
      id: 'ws_789',
      name: 'Legacy Thinking',
      slug: 'legacy-thinking',
      defaults: {
        thinkingLevel: 'think',
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    writeFileSync(join(workspaceRoot, 'config.json'), JSON.stringify(rawConfig, null, 2), 'utf-8');

    const loaded = loadWorkspaceConfig(workspaceRoot);
    expect(loaded).not.toBeNull();
    expect(loaded?.defaults?.thinkingLevel).toBe('medium');
  });
});
