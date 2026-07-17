/**
 * Tests for Agent Factory
 *
 * Verifies:
 * - Provider detection from auth type
 * - Backend creation for different providers
 * - LLM connection type mapping
 * - Available providers list
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { join } from 'node:path';
import {
  detectProvider,
  createBackend,
  createAgent,
  fetchBackendModels,
  getAvailableProviders,
  initializeBackendHostRuntime,
  isProviderAvailable,
  connectionTypeToProvider,
  connectionAuthTypeToBackendAuthType,
  providerTypeToAgentProvider,
  resolveBackendContext,
  resolveSetupTestConnectionHint,
  createBackendFromConnection,
  testBackendConnection,
  validateStoredBackendConnection,
} from '../factory.ts';
import type { BackendConfig } from '../types.ts';
import type { Workspace, LlmConnection } from '../../../config/storage.ts';
import type { SessionConfig as Session } from '../../../sessions/storage.ts';
import { PiAgent } from '../../pi-agent.ts';
import { piDriver } from '../internal/drivers/pi.ts';
import { isValidProviderAuthCombination } from '../../../config/llm-connections.ts';

// Test helpers
function createTestWorkspace(): Workspace {
  return {
    id: 'test-workspace',
    name: 'Test Workspace',
    slug: 'workspace',
    rootPath: '/test/workspace',
    createdAt: Date.now(),
  };
}

function createTestSession(): Session {
  return {
    id: 'test-session',
    name: 'Test Session',
    workspaceRootPath: '/test/workspace',
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    permissionMode: 'ask',
  };
}

function createTestConfig(overrides: Partial<BackendConfig> = {}): BackendConfig {
  return {
    provider: 'pi',
    workspace: createTestWorkspace(),
    session: createTestSession(),
    isHeadless: true, // Prevent config watchers from starting
    ...overrides,
  };
}

describe('detectProvider', () => {
  describe('Pi runtime authentication types', () => {
    it('should return pi for api_key', () => {
      expect(detectProvider('api_key')).toBe('pi');
    });

    it('should return pi for oauth_token', () => {
      expect(detectProvider('oauth_token')).toBe('pi');
    });
  });

  describe('Unknown authentication types', () => {
    it('should default to pi for unknown types', () => {
      expect(detectProvider('unknown')).toBe('pi');
      expect(detectProvider('')).toBe('pi');
    });
  });
});

describe('createBackend / createAgent', () => {
  describe('Legacy Anthropic runtime selector', () => {
    it('normalizes direct Anthropic creation to PiAgent', () => {
      const config = createTestConfig({ provider: 'anthropic' });
      expect(createBackend(config)).toBeInstanceOf(PiAgent);
    });
  });

  describe('Pi provider', () => {
    it('should create PiAgent for pi provider', () => {
      const config = createTestConfig({ provider: 'pi' });
      const agent = createBackend(config);

      expect(agent).toBeInstanceOf(PiAgent);
    });
  });

  describe('Unknown provider', () => {
    it('should throw for unknown provider', () => {
      const config = createTestConfig({ provider: 'unknown' as any });

      expect(() => createBackend(config)).toThrow('Unknown provider: unknown');
    });
  });

  describe('createAgent alias', () => {
    it('should be an alias for createBackend', () => {
      expect(createAgent).toBe(createBackend);
    });
  });
});

describe('getAvailableProviders', () => {
  it('returns only the Pi execution runtime', () => {
    const providers = getAvailableProviders();

    expect(providers).toEqual(['pi']);
  });
});

describe('isProviderAvailable', () => {
  it('should return false for the legacy Anthropic runtime', () => {
    expect(isProviderAvailable('anthropic')).toBe(false);
  });

  it('should return true for pi', () => {
    expect(isProviderAvailable('pi')).toBe(true);
  });

  it('should return false for unknown provider', () => {
    expect(isProviderAvailable('unknown' as any)).toBe(false);
  });
});

describe('connectionTypeToProvider', () => {
  it('should map anthropic type to the Pi runtime', () => {
    expect(connectionTypeToProvider('anthropic')).toBe('pi');
  });

  it('should map openai type to pi provider (legacy routing)', () => {
    expect(connectionTypeToProvider('openai')).toBe('pi');
  });

  it('should map openai-compat type to pi provider (legacy routing)', () => {
    expect(connectionTypeToProvider('openai-compat')).toBe('pi');
  });

  it('should default to pi for unknown types', () => {
    expect(connectionTypeToProvider('unknown' as any)).toBe('pi');
  });
});

describe('connectionAuthTypeToBackendAuthType (legacy)', () => {
  it('should map api_key to api_key', () => {
    expect(connectionAuthTypeToBackendAuthType('api_key')).toBe('api_key');
  });

  it('should pass through oauth', () => {
    expect(connectionAuthTypeToBackendAuthType('oauth')).toBe('oauth');
  });

  it('should map none to undefined', () => {
    expect(connectionAuthTypeToBackendAuthType('none')).toBeUndefined();
  });
});

describe('providerTypeToAgentProvider', () => {
  describe('Anthropic connections', () => {
    it('should execute anthropic through Pi', () => {
      expect(providerTypeToAgentProvider('anthropic')).toBe('pi');
    });
  });

  describe('Pi SDK providers', () => {
    it('should map pi to pi', () => {
      expect(providerTypeToAgentProvider('pi')).toBe('pi');
    });

    it('should map pi_compat to pi', () => {
      expect(providerTypeToAgentProvider('pi_compat')).toBe('pi');
    });
  });
});

// ============================================================
// Provider-Auth Validation Tests
// ============================================================

describe('isValidProviderAuthCombination', () => {
  describe('Anthropic provider', () => {
    it('should accept api_key auth', () => {
      expect(isValidProviderAuthCombination('anthropic', 'api_key')).toBe(true);
    });

    it('should accept oauth auth', () => {
      expect(isValidProviderAuthCombination('anthropic', 'oauth')).toBe(true);
    });

    it('should reject api_key_with_endpoint auth', () => {
      expect(isValidProviderAuthCombination('anthropic', 'api_key_with_endpoint')).toBe(false);
    });

    it('should reject none auth', () => {
      expect(isValidProviderAuthCombination('anthropic', 'none')).toBe(false);
    });
  });

  describe('Pi provider', () => {
    it('should accept api_key auth', () => {
      expect(isValidProviderAuthCombination('pi', 'api_key')).toBe(true);
    });

    it('should accept oauth auth', () => {
      expect(isValidProviderAuthCombination('pi', 'oauth')).toBe(true);
    });

    it('should accept none auth', () => {
      expect(isValidProviderAuthCombination('pi', 'none')).toBe(true);
    });
  });

  describe('Pi compat provider', () => {
    it('should accept api_key_with_endpoint auth', () => {
      expect(isValidProviderAuthCombination('pi_compat', 'api_key_with_endpoint')).toBe(true);
    });

    it('should accept none auth (for local models like Ollama)', () => {
      expect(isValidProviderAuthCombination('pi_compat', 'none')).toBe(true);
    });
  });

});

describe('phase4 backend abstraction APIs', () => {
  it('initializeBackendHostRuntime bootstraps without throwing in dev runtime', () => {
    expect(() => initializeBackendHostRuntime({
      hostRuntime: {
        appRootPath: process.cwd(),
        isPackaged: false,
      },
    })).not.toThrow();
  });

  it('initializeBackendHostRuntime does not require a Claude SDK binary', () => {
    expect(() => initializeBackendHostRuntime({
      hostRuntime: {
        appRootPath: join(process.cwd(), 'apps', 'electron', 'dist'),
        isPackaged: false,
      },
    })).not.toThrow();
  });

  it('resolveBackendContext defaults to the Pi runtime without a stored connection', () => {
    expect(resolveBackendContext({}).provider).toBe('pi');
  });

  it('resolveSetupTestConnectionHint maps provider/baseUrl/piAuthProvider correctly', () => {
    expect(resolveSetupTestConnectionHint({
      provider: 'anthropic',
      baseUrl: 'https://api.example.com',
    })).toEqual({ providerType: 'pi_compat' });

    expect(resolveSetupTestConnectionHint({
      provider: 'anthropic',
      baseUrl: '',
    })).toEqual({ providerType: 'anthropic' });

    expect(resolveSetupTestConnectionHint({
      provider: 'pi',
      piAuthProvider: 'openai-codex',
    })).toEqual({ providerType: 'pi', piAuthProvider: 'openai-codex' });

    expect(resolveSetupTestConnectionHint({
      provider: 'pi',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      customEndpoint: { api: 'openai-completions' },
    })).toEqual({ providerType: 'pi_compat', piAuthProvider: 'openai', customEndpoint: { api: 'openai-completions' } });

    expect(resolveSetupTestConnectionHint({
      provider: 'pi',
      baseUrl: 'https://my-anthropic-proxy.internal/v1',
      customEndpoint: { api: 'anthropic-messages' },
    })).toEqual({ providerType: 'pi_compat', piAuthProvider: 'anthropic', customEndpoint: { api: 'anthropic-messages' } });
  });

  it('fetchBackendModels dispatches for pi provider', async () => {
    const connection: LlmConnection = {
      slug: 'pi-test',
      name: 'Pi Test',
      providerType: 'pi',
      authType: 'none',
      createdAt: Date.now(),
    };

    const result = await fetchBackendModels({
      connection,
      credentials: {},
      hostRuntime: {
        appRootPath: process.cwd(),
        isPackaged: false,
      },
    });

    expect(result.models.length).toBeGreaterThan(0);
  });

  it('validateStoredBackendConnection returns not found for unknown slug', async () => {
    const result = await validateStoredBackendConnection({
      slug: '__missing-connection__',
      hostRuntime: {
        appRootPath: process.cwd(),
        isPackaged: false,
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Connection not found');
  });

  it('testBackendConnection keeps required model argument and validates key presence', async () => {
    const result = await testBackendConnection({
      provider: 'anthropic',
      apiKey: '   ',
      model: 'claude-sonnet-4-6',
      hostRuntime: {
        appRootPath: process.cwd(),
        isPackaged: false,
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('API key is required');
  });

  it('testBackendConnection routes Anthropic setup hints through the Pi driver', async () => {
    const originalTestConnection = piDriver.testConnection;
    let observedProvider: string | undefined;
    let observedProviderType: string | undefined;
    piDriver.testConnection = async (args) => {
      observedProvider = args.provider;
      observedProviderType = args.connection?.providerType;
      return { success: true };
    };

    try {
      const result = await testBackendConnection({
        provider: 'anthropic',
        apiKey: '',
        allowEmptyApiKey: true,
        model: 'claude-sonnet-4-6',
        connection: { providerType: 'anthropic' },
        hostRuntime: {
          appRootPath: process.cwd(),
          isPackaged: false,
        },
      });

      expect(result).toEqual({ success: true });
      expect(observedProvider).toBe('pi');
      expect(observedProviderType).toBe('anthropic');
    } finally {
      piDriver.testConnection = originalTestConnection;
    }
  });
});

describe('PiAgent model switching', () => {
  it('setModel updates getModel (regression: setModel used to write config.model but getModel reads _model)', () => {
    const agent = createBackend(createTestConfig({ provider: 'pi', model: 'claude-opus-4-7' }));

    expect(agent.getModel()).toBe('claude-opus-4-7');

    agent.setModel('claude-sonnet-4-6');

    expect(agent.getModel()).toBe('claude-sonnet-4-6');
  });
});
