// input: Mutable Pi init credentials and a process-local model runtime
// output: Proof that an auth reset rebuilds Pi storage from the current credential
// pos: Regression check for credential rotation at the model-runtime boundary

import { describe, expect, it } from 'bun:test';
import type { PiInitMessage } from '../../shared/src/agent/backend/pi/protocol.ts';
import { PiModelRuntime } from './pi-model-runtime.ts';

describe('PiModelRuntime', () => {
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
