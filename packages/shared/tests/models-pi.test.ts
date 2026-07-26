// input: Installed Pi SDK catalog and Storyflow model/provider filters
// output: Regression coverage for provider visibility and excluded model families
// pos: Verifies the server-side Pi model discovery contract

import { describe, it, expect } from 'bun:test';
import { getPiApiKeyProviders, getPiModelsForAuthProvider } from '../src/config/models-pi.ts';

describe('models-pi filtering', () => {
  it('excludes codex-mini-latest for openai models', () => {
    const models = getPiModelsForAuthProvider('openai');
    const ids = models.map(m => m.id);
    expect(ids.includes('pi/codex-mini-latest')).toBe(false);
  });

  it('excludes all gpt-4* models for openai models', () => {
    const models = getPiModelsForAuthProvider('openai');
    const ids = models.map(m => m.id);
    expect(ids.some(id => id.startsWith('pi/gpt-4'))).toBe(false);
  });

  it('includes DeepSeek in the Pi API key provider list with a human-readable label', () => {
    const providers = getPiApiKeyProviders();
    expect(providers.some(provider => provider.key === 'deepseek' && provider.label === 'DeepSeek')).toBe(true);
  });

  it('returns current DeepSeek models from the Pi SDK catalog', () => {
    const models = getPiModelsForAuthProvider('deepseek');
    const ids = models.map(m => m.id);
    expect(ids).toContain('pi/deepseek-v4-flash');
    expect(ids).toContain('pi/deepseek-v4-pro');
  });

  it('exposes the GPT-5.6 family for OpenAI-compatible Pi providers', () => {
    const expectedIds = [
      'pi/gpt-5.6-sol',
      'pi/gpt-5.6-terra',
      'pi/gpt-5.6-luna',
    ];

    for (const provider of ['openai', 'openai-codex', 'azure-openai-responses']) {
      const ids = getPiModelsForAuthProvider(provider).map(model => model.id);
      for (const id of expectedIds) {
        expect(ids).toContain(id);
      }
    }
  });
});
