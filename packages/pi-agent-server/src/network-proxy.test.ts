// input: Provider request URLs and subprocess proxy environment.
// output: Regression proof for protocol-specific proxy and NO_PROXY routing.
// pos: Pure contract test for the Pi subprocess transport boundary.

import { afterEach, describe, expect, test } from 'bun:test';
import { installNetworkProxy, resolveProxyForUrl } from './network-proxy.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('resolveProxyForUrl', () => {
  test('selects the protocol proxy and respects NO_PROXY', () => {
    const env = {
      HTTP_PROXY: 'http://http-proxy.test:8080',
      HTTPS_PROXY: 'http://https-proxy.test:8443',
      NO_PROXY: 'localhost,.internal.test',
    };

    expect(resolveProxyForUrl('http://example.test/v1', env)).toBe(env.HTTP_PROXY);
    expect(resolveProxyForUrl('https://example.test/v1', env)).toBe(env.HTTPS_PROXY);
    expect(resolveProxyForUrl('https://api.internal.test/v1', env)).toBeUndefined();
    expect(resolveProxyForUrl('http://localhost:3000', env)).toBeUndefined();
  });

  test('adds only Bun proxy routing and preserves fetch helpers', async () => {
    const preconnect = () => {};
    let receivedInit: (RequestInit & { proxy?: string }) | undefined;
    globalThis.fetch = Object.assign(async (_input: string | URL | Request, init?: RequestInit) => {
      receivedInit = init;
      return new Response('ok');
    }, { preconnect });

    installNetworkProxy({ HTTPS_PROXY: 'http://proxy.test:8443' });

    expect(globalThis.fetch.preconnect).toBe(preconnect);
    const response = await globalThis.fetch('https://provider.test/v1', {
      method: 'POST',
      body: 'unchanged',
    });
    expect(await response.text()).toBe('ok');
    expect(receivedInit).toEqual({
      method: 'POST',
      body: 'unchanged',
      proxy: 'http://proxy.test:8443',
    });
  });
});
