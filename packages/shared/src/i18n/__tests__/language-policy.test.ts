// input: Supported language metadata and language-policy formatters
// output: Regression coverage for localized replies and artifact naming rules
// pos: Contract tests for the shared user-language boundary

import { describe, expect, it } from 'bun:test';
import { LANGUAGES, SUPPORTED_LANGUAGE_CODES } from '../languages';
import {
  formatLanguagePolicyForPrompt,
  formatLanguageReminderForPrompt,
  resolveLanguageCode,
} from '../language-policy';

describe('language policy', () => {
  it('gives Chinese users an explicit reply and file naming rule', () => {
    const policy = formatLanguagePolicyForPrompt('zh-Hans');

    expect(policy).toContain('使用简体中文回答');
    expect(policy).toContain('创建或重命名用户可见的文件、文件夹');
    expect(policy).toContain('Skill 的 slug');
    expect(policy).toContain('zh-Hans');
  });

  it('keeps English as a real selected-language policy', () => {
    const policy = formatLanguagePolicyForPrompt('en');

    expect(policy).toContain('Reply in English by default');
    expect(policy).toContain('human-readable English names');
    expect(policy).toContain('runtime-constrained Skill slugs');
  });

  it('supports every product language and emits a final reminder', () => {
    for (const code of SUPPORTED_LANGUAGE_CODES) {
      const policy = formatLanguagePolicyForPrompt(code);
      const reminder = formatLanguageReminderForPrompt(code);

      expect(policy).toContain(LANGUAGES[code].nativeName);
      expect(reminder).toContain('<language_policy_reminder>');
      expect(reminder).toContain(LANGUAGES[code].nativeName);
    }
  });

  it('normalizes locale tags and common language names', () => {
    expect(resolveLanguageCode('zh-CN')).toBe('zh-Hans');
    expect(resolveLanguageCode('German')).toBe('de');
    expect(resolveLanguageCode('ja-JP')).toBe('ja');
    expect(resolveLanguageCode('unknown-language')).toBe('en');
  });
});
