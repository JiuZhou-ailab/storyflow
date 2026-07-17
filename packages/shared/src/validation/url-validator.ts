// input: A candidate Craft MCP URL
// output: A deterministic validation result with a user-facing error when invalid
// pos: Pure trust-boundary validation for Craft MCP connection URLs

import { debug } from '../utils/debug.ts';

export interface UrlValidationResult {
  valid: boolean;
  error?: string;
}

const CRAFT_MCP_HOSTNAME = 'mcp.craft.do';
const CRAFT_MCP_PATH = /^\/links\/([A-Za-z0-9_-]+)\/mcp\/?$/;

/**
 * Validate a Craft MCP URL without invoking an agent runtime.
 *
 * Credentials are retained in the signature for source compatibility with
 * existing callers, but URL syntax is a deterministic concern and does not
 * require model access.
 */
export async function validateMcpUrl(
  input: string,
  _apiKey?: string,
  _oauthToken?: string,
): Promise<UrlValidationResult> {
  debug('[url-validator] Validating URL:', input);

  if (input !== input.trim() || /\s/.test(input)) {
    return { valid: false, error: 'Enter only the Craft MCP URL, without extra text or spaces.' };
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { valid: false, error: 'Enter a valid URL beginning with https://.' };
  }

  if (url.protocol !== 'https:') {
    return { valid: false, error: 'Craft MCP URLs must use https://.' };
  }

  if (url.hostname !== CRAFT_MCP_HOSTNAME || url.port) {
    return { valid: false, error: `The URL host must be exactly ${CRAFT_MCP_HOSTNAME}.` };
  }

  if (url.username || url.password) {
    return { valid: false, error: 'Credentials are not allowed in the URL.' };
  }

  if (url.search || url.hash) {
    return { valid: false, error: 'Craft MCP URLs cannot contain query parameters or fragments.' };
  }

  if (!CRAFT_MCP_PATH.test(url.pathname)) {
    return {
      valid: false,
      error: 'Use a Craft MCP URL in the form https://mcp.craft.do/links/LINK_ID/mcp.',
    };
  }

  return { valid: true };
}
