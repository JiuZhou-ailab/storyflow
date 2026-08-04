// input: Raw provider errors surfaced by Pi
// output: Regression coverage for stable connection error presentation
// pos: Presentation contract independent of provider transport

import { describe, expect, test } from 'bun:test';
import { parseValidationError } from '../llm-validation.ts';

describe('parseValidationError', () => {
  test('maps Pi authentication errors to a user-facing message', () => {
    expect(parseValidationError('HTTP 401: invalid x-api-key')).toBe(
      'Authentication failed. Check your API key or OAuth token.',
    );
  });

  test('maps Pi network errors to a user-facing message', () => {
    expect(parseValidationError('fetch failed: ENOTFOUND example.test')).toBe(
      'Cannot connect to API server. Check the URL and ensure the server is running.',
    );
  });
});
