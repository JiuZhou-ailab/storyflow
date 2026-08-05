/**
 * Tests for auth state management
 *
 * These tests verify:
 * - Setup needs derivation from auth state
 */
import { describe, it, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import {
  getSetupNeeds,
  type AuthState,
} from '../state.ts';

const AUTH_STATE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'state.ts')).href;
const CREDENTIALS_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', '..', 'credentials', 'index.ts')).href;

function setupAuthStateConfigDir() {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-agent-auth-state-'));
  const workspaceRoot = join(configDir, 'workspaces', 'workspace');
  mkdirSync(workspaceRoot, { recursive: true });

  writeFileSync(
    join(configDir, 'config.json'),
    JSON.stringify({
      workspaces: [{ id: 'ws-1', name: 'Workspace', rootPath: workspaceRoot, createdAt: Date.now() }],
      activeWorkspaceId: 'ws-1',
      activeSessionId: null,
      defaultLlmConnection: 'anthropic-api',
      llmConnections: [{
        slug: 'anthropic-api',
        name: 'Anthropic API',
        providerType: 'anthropic',
        authType: 'api_key',
        createdAt: Date.now(),
      }],
    }, null, 2),
    'utf-8',
  );

  return configDir;
}

function runAuthStateEval(configDir: string, code: string): string {
  const run = Bun.spawnSync([
    process.execPath,
    '--eval',
    `const [{ getAuthState }, { getCredentialManager }] = await Promise.all([import('${AUTH_STATE_MODULE_PATH}'), import('${CREDENTIALS_MODULE_PATH}')]); ${code}`,
  ], {
    env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (run.exitCode !== 0) {
    throw new Error(`subprocess failed (exit ${run.exitCode})\nstderr:\n${run.stderr.toString()}`);
  }

  return run.stdout.toString().trim();
}

// ============================================
// getAuthState tests
// ============================================

describe('getAuthState', () => {
  it('reads api-key credentials once for the default connection', () => {
    const configDir = setupAuthStateConfigDir();

    const output = runAuthStateEval(configDir, `
      const manager = getCredentialManager();
      let apiKeyReads = 0;
      manager.getLlmApiKey = async (slug) => {
        apiKeyReads += 1;
        return slug === 'anthropic-api' ? 'sk-test' : null;
      };
      const authState = await getAuthState();
      console.log(JSON.stringify({
        apiKeyReads,
        hasCredentials: authState.billing.hasCredentials,
        apiKey: authState.billing.apiKey,
      }));
    `);

    expect(JSON.parse(output)).toEqual({
      apiKeyReads: 1,
      hasCredentials: true,
      apiKey: 'sk-test',
    });
  });
});

// ============================================
// getSetupNeeds tests (pure function)
// ============================================

describe('getSetupNeeds', () => {
  describe('billing configuration', () => {
    it('should need billing config when type is null', () => {
      const state: AuthState = {
        billing: {
          type: null,
          hasCredentials: false,
          apiKey: null,
          claudeOAuthToken: null,
        },
        workspace: { hasWorkspace: false, active: null },
      };

      const needs = getSetupNeeds(state);

      expect(needs.needsBillingConfig).toBe(true);
      expect(needs.needsCredentials).toBe(false);
      expect(needs.isFullyConfigured).toBe(false);
    });

    it('should not need billing config when type is set', () => {
      const state: AuthState = {
        billing: {
          type: 'api_key',
          hasCredentials: true,
          apiKey: 'sk-test',
          claudeOAuthToken: null,
        },
        workspace: { hasWorkspace: false, active: null },
      };

      const needs = getSetupNeeds(state);

      expect(needs.needsBillingConfig).toBe(false);
    });
  });

  describe('credentials', () => {
    it('should need credentials when type is set but hasCredentials is false', () => {
      const state: AuthState = {
        billing: {
          type: 'oauth_token',
          hasCredentials: false,
          apiKey: null,
          claudeOAuthToken: null,
        },
        workspace: { hasWorkspace: false, active: null },
      };

      const needs = getSetupNeeds(state);

      expect(needs.needsBillingConfig).toBe(false);
      expect(needs.needsCredentials).toBe(true);
      expect(needs.isFullyConfigured).toBe(false);
    });

    it('should not need credentials when hasCredentials is true', () => {
      const state: AuthState = {
        billing: {
          type: 'oauth_token',
          hasCredentials: true,
          apiKey: null,
          claudeOAuthToken: 'valid-token',
        },
        workspace: { hasWorkspace: false, active: null },
      };

      const needs = getSetupNeeds(state);

      expect(needs.needsCredentials).toBe(false);
      expect(needs.isFullyConfigured).toBe(true);
    });
  });

  describe('fully configured', () => {
    it('should be fully configured when billing type and credentials are set', () => {
      const state: AuthState = {
        billing: {
          type: 'api_key',
          hasCredentials: true,
          apiKey: 'sk-test',
          claudeOAuthToken: null,
        },
        workspace: { hasWorkspace: true, active: null },
      };

      const needs = getSetupNeeds(state);

      expect(needs.isFullyConfigured).toBe(true);
      expect(needs.needsBillingConfig).toBe(false);
      expect(needs.needsCredentials).toBe(false);
    });
  });
});
