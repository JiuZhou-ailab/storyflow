// input: Pi connection metadata and resolved runtime paths
// output: Regression coverage for direct Pi runtime configuration
// pos: Focused contract test for the Storyflow-to-Pi configuration bridge

import { describe, expect, it } from 'bun:test';
import { buildPiRuntime } from './pi.ts';

describe('buildPiRuntime custom endpoint models', () => {
  it('preserves explicit per-model supportsImages values', () => {
    const runtime = buildPiRuntime({
      context: {
        authType: 'api_key',
        resolvedModel: 'vision-model',
        connection: {
          slug: 'custom-endpoint',
          name: 'Custom Endpoint',
          providerType: 'pi',
          authType: 'api_key',
          baseUrl: 'http://127.0.0.1:11111/v1',
          customEndpoint: { api: 'anthropic-messages', supportsImages: true },
          models: [
            { id: 'vision-model', contextWindow: 262_144, supportsImages: true, supportsThinking: true },
            {
              id: 'luna-model',
              supportsThinking: true,
              thinkingLevelMap: {
                off: 'none',
                minimal: null,
                low: 'low',
                medium: 'medium',
                high: 'high',
                xhigh: 'xhigh',
                max: null,
              },
            },
            { id: 'text-only-model', supportsImages: false },
            { id: 'plain-model' },
          ],
          createdAt: Date.now(),
        } as any,
      },
      resolvedPaths: {
        piServerPath: '/tmp/pi-agent-server.js',
        nodeRuntimePath: '/usr/bin/node',
      },
    });

    expect(runtime.customModels).toEqual([
      { id: 'vision-model', contextWindow: 262_144, supportsImages: true, supportsThinking: true },
      {
        id: 'luna-model',
        supportsThinking: true,
        thinkingLevelMap: {
          off: 'none',
          minimal: null,
          low: 'low',
          medium: 'medium',
          high: 'high',
          xhigh: 'xhigh',
          max: null,
        },
      },
      { id: 'text-only-model', supportsImages: false },
      'plain-model',
    ]);
  });
});
