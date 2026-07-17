// input: Representative valid and hostile Craft MCP URL strings
// output: Regression coverage for deterministic Craft MCP URL validation
// pos: Trust-boundary tests for the shared URL validator

import { describe, expect, test } from 'bun:test';
import { validateMcpUrl } from '../url-validator.ts';

describe('validateMcpUrl', () => {
  test('accepts the canonical Craft MCP URL shape', async () => {
    expect(await validateMcpUrl('https://mcp.craft.do/links/xY9-abc_123/mcp')).toEqual({
      valid: true,
    });
  });

  test.each([
    'mcp.craft.do/links/abc/mcp',
    'http://mcp.craft.do/links/abc/mcp',
    'https://mcp.craft.do.evil.com/links/abc/mcp',
    'https://user:pass@mcp.craft.do/links/abc/mcp',
    'https://mcp.craft.do/links/abc%2Fdef/mcp',
    'https://mcp.craft.do/links/abc/mcp?token=secret',
    'https://mcp.craft.do/links/abc/mcp extra text',
  ])('rejects invalid or hostile input: %s', async (input) => {
    const result = await validateMcpUrl(input);
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
