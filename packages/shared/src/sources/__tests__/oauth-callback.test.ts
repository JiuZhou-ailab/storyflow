// input: Workspace-owned OAuth Source fixtures and mocked discovery responses
// output: Direct server callback and OAuth state regression coverage
// pos: SourceCredentialManager OAuth callback contract test

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { SourceCredentialManager } from '../credential-manager.ts';
import type { LoadedSource, FolderSourceConfig } from '../types.ts';

const originalFetch = globalThis.fetch;

function createApiSource(overrides: Partial<FolderSourceConfig> = {}): LoadedSource {
  return {
    config: {
      id: 'test-id',
      slug: 'gmail-test',
      name: 'Gmail Test',
      type: 'api',
      provider: 'google',
      enabled: true,
      api: {
        baseUrl: 'https://gmail.googleapis.com/',
        authType: 'bearer',
        googleService: 'gmail',
        googleOAuthClientId: 'test-client-id',
        googleOAuthClientSecret: 'test-client-secret',
      },
      ...overrides,
    } as FolderSourceConfig,
    guide: null,
    folderPath: '/tmp/test/sources/gmail-test',
    workspaceRootPath: '/tmp/test',
    workspaceId: 'test-workspace',
    definitionIdentity: 'test-definition',
    origin: 'workspace',
  };
}

function createMcpSource(overrides: Partial<FolderSourceConfig> = {}): LoadedSource {
  return {
    config: {
      id: 'test-mcp-id',
      slug: 'mcp-test',
      name: 'MCP Test',
      type: 'mcp',
      enabled: true,
      mcp: {
        transport: 'http',
        url: 'https://example.com/mcp',
      },
      ...overrides,
    } as FolderSourceConfig,
    guide: null,
    folderPath: '/tmp/test/sources/mcp-test',
    workspaceRootPath: '/tmp/test',
    workspaceId: 'test-workspace',
    definitionIdentity: 'test-definition',
    origin: 'workspace',
  };
}

describe('SourceCredentialManager.prepareOAuth direct callbacks', () => {
  const credManager = new SourceCredentialManager();
  const callbackUrl = 'https://storyflow.example/api/oauth/callback';
  let registeredRedirectUris: string[];

  beforeEach(() => {
    registeredRedirectUris = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === 'https://example.com/.well-known/oauth-authorization-server') {
        return Response.json({
          authorization_endpoint: 'https://example.com/oauth/authorize',
          token_endpoint: 'https://example.com/oauth/token',
          registration_endpoint: 'https://example.com/oauth/register',
        });
      }
      if (url === 'https://example.com/oauth/register') {
        registeredRedirectUris = JSON.parse(init!.body as string).redirect_uris;
        return Response.json({ client_id: 'registered-client' });
      }
      return new Response('Not Found', { status: 404 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it.each([
    ['Google', createApiSource()],
    ['generic', createApiSource({
      provider: 'custom',
      api: {
        baseUrl: 'https://example.com', authType: 'oauth',
        oauth: {
          authorizationUrl: 'https://example.com/oauth/authorize',
          tokenUrl: 'https://example.com/oauth/token', clientId: 'test-client',
        },
      },
    })],
    ['generic discovery', createApiSource({
      provider: 'custom', api: { baseUrl: 'https://example.com/mcp', authType: 'oauth' },
    })],
    ['MCP', createMcpSource()],
  ])('uses the server callback and original state for %s', async (provider, source) => {
    const result = await credManager.prepareOAuth(source, { callbackUrl });
    const authUrl = new URL(result.authUrl);
    expect(result.redirectUri).toBe(callbackUrl);
    expect(result.state).toBeTruthy();
    expect(authUrl.searchParams.get('redirect_uri')).toBe(callbackUrl);
    expect(authUrl.searchParams.get('state')).toBe(result.state);
    expect(result.authUrl).not.toContain('agents.craft.do');
    if (provider === 'MCP' || provider === 'generic discovery') {
      expect(registeredRedirectUris).toEqual([callbackUrl]);
    }
  });

  it('preserves desktop Google loopback callbacks', async () => {
    const result = await credManager.prepareOAuth(createApiSource(), { callbackPort: 6477 });
    const authUrl = new URL(result.authUrl);
    expect(result.redirectUri).toBe('http://localhost:6477/callback');
    expect(authUrl.searchParams.get('redirect_uri')).toBe(result.redirectUri);
    expect(authUrl.searchParams.get('state')).toBe(result.state);
  });
});
