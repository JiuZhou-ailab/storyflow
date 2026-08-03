// input: Pi subprocess proxy environment and provider request URLs.
// output: A narrowly proxied global fetch preserving native provider payloads and responses.
// pos: Transport-only adapter below the Pi provider protocol boundary.

import { parseNoProxyRules, shouldBypassProxy } from '../../shared/src/config/proxy-utils.ts';

type ProxyEnvironment = Record<string, string | undefined>;
type ProxyRequestInit = RequestInit & { proxy?: string };

export function resolveProxyForUrl(url: string, env: ProxyEnvironment = process.env): string | undefined {
  const rules = parseNoProxyRules(env.NO_PROXY || env.no_proxy);
  if (shouldBypassProxy(url, rules)) return undefined;

  return new URL(url).protocol === 'https:'
    ? env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy
    : env.HTTP_PROXY || env.http_proxy;
}

export function installNetworkProxy(env: ProxyEnvironment = process.env): void {
  if (!env.HTTP_PROXY && !env.http_proxy && !env.HTTPS_PROXY && !env.https_proxy) return;

  const originalFetch = globalThis.fetch;
  const proxiedFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const proxy = resolveProxyForUrl(url, env);
    return originalFetch(input, proxy ? { ...init, proxy } as ProxyRequestInit : init);
  };

  globalThis.fetch = new Proxy(proxiedFetch, {
    get(target, property, receiver) {
      return property in originalFetch
        ? (originalFetch as unknown as Record<PropertyKey, unknown>)[property]
        : Reflect.get(target, property, receiver);
    },
  }) as typeof fetch;
}
