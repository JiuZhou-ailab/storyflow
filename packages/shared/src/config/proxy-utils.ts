// input: Proxy configuration strings and request URLs.
// output: Parsed NO_PROXY rules and deterministic bypass decisions.
// pos: Runtime-neutral proxy routing primitives shared by Electron and subprocesses.

/** Split a comma-separated string into trimmed, non-empty entries. */
export function splitCommaSeparated(str: string | undefined): string[] {
  if (!str) return [];
  return str.split(',').map(s => s.trim()).filter(Boolean);
}

export interface NoProxyRule {
  host: string;
  port?: number;
  wildcard: boolean;
}

export function parseNoProxyRules(noProxy: string | undefined): NoProxyRule[] {
  return splitCommaSeparated(noProxy)
    .map(entry => entry.toLowerCase())
    .map(entry => {
      if (entry === '*') return { host: '*', wildcard: true };

      const cleaned = entry.startsWith('.') ? entry.slice(1) : entry;
      if (cleaned.startsWith('[')) {
        const closeBracket = cleaned.indexOf(']');
        if (closeBracket > 0) {
          const host = cleaned.slice(1, closeBracket);
          const port = Number.parseInt(cleaned.slice(closeBracket + 2), 10);
          return Number.isNaN(port)
            ? { host, wildcard: false }
            : { host, port, wildcard: false };
        }
      }

      const lastColon = cleaned.lastIndexOf(':');
      const port = Number.parseInt(cleaned.slice(lastColon + 1), 10);
      return lastColon > 0 && !Number.isNaN(port)
        ? { host: cleaned.slice(0, lastColon), port, wildcard: false }
        : { host: cleaned, wildcard: false };
    });
}

const DEFAULT_PORTS: Record<string, number> = { 'http:': 80, 'https:': 443 };

export function shouldBypassProxy(url: string | URL, rules: NoProxyRule[]): boolean {
  if (rules.length === 0) return false;

  const parsed = typeof url === 'string' ? new URL(url) : url;
  const hostname = parsed.hostname.toLowerCase();
  const host = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  const port = parsed.port ? Number.parseInt(parsed.port, 10) : DEFAULT_PORTS[parsed.protocol];

  return rules.some(rule =>
    rule.wildcard ||
    ((rule.port === undefined || rule.port === port) &&
      (host === rule.host || host.endsWith(`.${rule.host}`))),
  );
}
