// input: Mutable Pi init credentials and a process-local model runtime
// output: Proof that an auth reset rebuilds Pi storage from the current credential
// pos: Regression check for credential rotation at the model-runtime boundary

import { describe, expect, it } from 'bun:test';
import type { PiInitMessage } from '../../shared/src/agent/backend/pi/protocol.ts';
import { PiModelRuntime } from './pi-model-runtime.ts';
import { buildPiRuntime } from '../../shared/src/agent/backend/internal/drivers/pi.ts';
import { cloneManagedModelCatalog } from '../../shared/src/config/managed-model-catalog.ts';
import type { LlmConnection } from '../../shared/src/config/llm-connections.ts';

describe('PiModelRuntime', () => {
  it('preserves explicit fallback limits through the Host payload and real model registration', async () => {
    const catalog = cloneManagedModelCatalog('openai-completions');
    expect(catalog.every(model => model.fallbackCapabilities?.maxOutputTokens === 384_000)).toBe(true);
    const declared = catalog.map(model => ({ ...model,
      fallbackCapabilities: { maxOutputTokens: 4096, tools: true, structuredOutput: 'prompt' as const },
    }));
    const connection = {
      slug: 'storyflow-managed-deepseek', providerType: 'pi_compat', piAuthProvider: 'openai',
      baseUrl: 'http://127.0.0.1:1/v1', customEndpoint: { api: 'openai-completions' }, models: declared,
    } as LlmConnection;
    const payload = buildPiRuntime({ context: { connection, resolvedModel: 'deepseek-v4-flash' }, resolvedPaths: {} });
    const config = {
      type: 'init', apiKey: '', model: 'deepseek-v4-flash', ...payload,
      piAuth: { provider: 'openai', credential: { type: 'api_key', key: 'loopback-only' } },
    } as PiInitMessage;
    const runtime = new PiModelRuntime(() => config, () => {}, () => {});
    const models = await runtime.getModelsRuntime();
    expect(config.customModels?.[0]).toMatchObject({ fallbackCapabilities: declared[0]!.fallbackCapabilities });
    expect(models.getModel('custom-endpoint', 'deepseek-v4-flash')?.maxTokens).toBe(4096);
    config.customModels = catalog;
    runtime.refreshCustomEndpointModels(models);
    expect(models.getModel('custom-endpoint', 'deepseek-v4-flash')?.maxTokens).toBe(8192);
    config.customModels = catalog.map(({ fallbackCapabilities: _capabilities, ...model }) => model);
    runtime.refreshCustomEndpointModels(models);
    expect(models.getModel('custom-endpoint', 'deepseek-v4-flash')?.maxTokens).toBe(8192);
    expect(config.customModels.every(model => typeof model !== 'string' && !model.fallbackCapabilities)).toBe(true);
  });

  it('rebuilds credential storage from the current config after reset', async () => {
    const config: PiInitMessage = {
      type: 'init',
      apiKey: '',
      model: 'claude-sonnet-4-6',
      cwd: '/tmp',
      thinkingLevel: 'off',
      workspaceRootPath: '/tmp',
      sessionId: 'session',
      sessionPath: '/tmp/session',
      workingDirectory: '/tmp',
      plansFolderPath: '/tmp/session/plans',
      piAuth: { provider: 'anthropic', credential: { type: 'api_key', key: 'first' } },
    };
    const runtime = new PiModelRuntime(() => config, () => {}, () => {});

    const firstModels = await runtime.getModelsRuntime();
    expect((await firstModels.getAuth('anthropic'))?.auth.apiKey).toBe('first');

    config.piAuth = { provider: 'anthropic', credential: { type: 'api_key', key: 'second' } };
    runtime.resetAuth();
    const secondModels = await runtime.getModelsRuntime();
    expect((await secondModels.getAuth('anthropic'))?.auth.apiKey).toBe('second');
  });
});
