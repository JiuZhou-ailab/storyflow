// input: Built-in and custom provider model identifiers
// output: Regression coverage for model detection and user-visible names
// pos: Shared model catalog contract tests

import { describe, it, expect } from 'bun:test';
import {
  isClaudeModel,
  isOpusModel,
  getModelShortName,
  getModelDisplayName,
  ANTHROPIC_MODELS,
  getModelIdByShortName,
  normalizeDeprecatedModelId,
} from '../src/config/models.ts';
import {
  setModelSupportsImages,
  type LlmConnection,
} from '../src/config/llm-connections.ts';

describe('isClaudeModel', () => {
  // Direct Anthropic model IDs
  it('detects direct Anthropic Claude model IDs', () => {
    expect(isClaudeModel('claude-sonnet-4-6')).toBe(true);
    expect(isClaudeModel('claude-opus-4-7')).toBe(true);
    expect(isClaudeModel('claude-haiku-4-5-20251001')).toBe(true);
    expect(isClaudeModel('claude-3-5-sonnet-20241022')).toBe(true);
  });

  // OpenRouter provider-prefixed Claude IDs
  it('detects OpenRouter-prefixed Claude model IDs', () => {
    expect(isClaudeModel('anthropic/claude-sonnet-4')).toBe(true);
    expect(isClaudeModel('anthropic/claude-opus-4-7')).toBe(true);
    expect(isClaudeModel('anthropic/claude-3.5-haiku')).toBe(true);
  });

  // Non-Claude models via OpenRouter
  it('rejects non-Claude OpenRouter models', () => {
    expect(isClaudeModel('openai/gpt-5')).toBe(false);
    expect(isClaudeModel('openai/gpt-4o')).toBe(false);
    expect(isClaudeModel('google/gemini-2.5-pro')).toBe(false);
    expect(isClaudeModel('meta-llama/llama-4-maverick')).toBe(false);
    expect(isClaudeModel('deepseek/deepseek-r1')).toBe(false);
    expect(isClaudeModel('mistralai/mistral-large')).toBe(false);
  });

  // Non-Claude models via Ollama (no provider prefix)
  it('rejects non-Claude Ollama models', () => {
    expect(isClaudeModel('llama3.2')).toBe(false);
    expect(isClaudeModel('deepseek-r1')).toBe(false);
    expect(isClaudeModel('qwen3-coder')).toBe(false);
    expect(isClaudeModel('mistral')).toBe(false);
    expect(isClaudeModel('gemma2')).toBe(false);
  });

  // Bedrock-native model IDs
  it('detects Bedrock-native Claude model IDs', () => {
    expect(isClaudeModel('anthropic.claude-opus-4-7-v1')).toBe(true);
    expect(isClaudeModel('anthropic.claude-sonnet-4-6')).toBe(true);
    expect(isClaudeModel('anthropic.claude-haiku-4-5-20251001-v1:0')).toBe(true);
  });

  // Case insensitivity
  it('handles case variations', () => {
    expect(isClaudeModel('Claude-Sonnet-4-6')).toBe(true);
    expect(isClaudeModel('CLAUDE-OPUS-4-7')).toBe(true);
    expect(isClaudeModel('Anthropic/Claude-Sonnet-4')).toBe(true);
  });
});

describe('getModelShortName', () => {
  it('returns registry shortName for known models', () => {
    expect(getModelShortName('claude-opus-4-7')).toBe('Opus');
    expect(getModelShortName('claude-sonnet-4-6')).toBe('Sonnet');
    expect(getModelShortName('claude-haiku-4-5-20251001')).toBe('Haiku');
  });

  it('preserves unknown custom model IDs instead of guessing display names', () => {
    const ids = [
      'openai/gpt-5.4',
      'gpt-5.4',
      'glm-4.7',
      'mistral',
      'deepseek-r1',
      'claude-sonnet-3-5-20241022',
    ];

    for (const id of ids) {
      expect(getModelShortName(id)).toBe(id);
      expect(getModelDisplayName(id)).toBe(id);
    }
  });

  it('keeps an unknown custom model label stable across capability promotion', () => {
    const modelId = 'vendor/custom-model-alpha';
    const connection: LlmConnection = {
      slug: 'custom',
      name: 'Custom Endpoint',
      providerType: 'pi_compat',
      authType: 'api_key_with_endpoint',
      baseUrl: 'http://localhost:8080',
      customEndpoint: { api: 'openai-completions' },
      models: [modelId],
      createdAt: 1,
    };

    const promoted = setModelSupportsImages(connection, modelId, true).models?.[0];
    expect(typeof promoted).toBe('object');
    expect(typeof promoted === 'string' ? promoted : promoted?.name).toBe(modelId);

    const canonicalConnection: LlmConnection = {
      ...connection,
      models: [{
        id: 'gpt-5.5',
        name: 'GPT-5.5',
        shortName: 'GPT-5.5',
        description: '',
        provider: 'pi',
        contextWindow: 131_072,
        supportsThinking: true,
      }],
    };
    const updatedCanonical = setModelSupportsImages(canonicalConnection, 'gpt-5.5', true).models?.[0];
    expect(typeof updatedCanonical === 'string' ? updatedCanonical : updatedCanonical?.name).toBe('GPT-5.5');
  });
});

describe('current Claude registry', () => {
  it('includes current Opus, Sonnet, Fable, and previous generations', () => {
    const ids = ANTHROPIC_MODELS.map(m => m.id);
    expect(ids[0]).toBe('claude-opus-4-8');
    expect(ids).toContain('claude-sonnet-5');
    expect(ids).toContain('claude-fable-5');
    expect(ids).toContain('claude-opus-4-7');
    expect(ids).toContain('claude-sonnet-4-6');
  });

  it('resolves "Opus" shortName to 4.8 (first match wins)', () => {
    expect(getModelIdByShortName('Opus')).toBe('claude-opus-4-8');
  });

  it('normalizes deprecated Opus IDs to current supported IDs', () => {
    expect(normalizeDeprecatedModelId('claude-opus-4-6')).toBe('claude-opus-4-8');
    expect(normalizeDeprecatedModelId('pi/claude-opus-4-6')).toBe('pi/claude-opus-4-8');
    expect(normalizeDeprecatedModelId('anthropic.claude-opus-4-7-v1')).toBe('anthropic.claude-opus-4-7');
  });
});
