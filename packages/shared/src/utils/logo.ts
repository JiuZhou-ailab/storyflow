/**
 * Logo URL utility
 *
 * Returns Google Favicon URLs for APIs and MCP servers.
 * Browser handles caching - no need to save files locally.
 */

import { debug } from './debug.ts';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import { readJsonFileSync } from './files.ts';

// Cache path for persisted provider domains
const CRAFT_AGENT_DIR = join(homedir(), '.craft-agent');
const PROVIDER_DOMAINS_CACHE_PATH = join(CRAFT_AGENT_DIR, 'provider-domains.json');

// Google Favicon V2 API - free, reliable, no API key needed
// Updated URL: Google migrated from /s2/favicons to faviconV2
const GOOGLE_FAVICON_URL = 'https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=';

/**
 * Canonical domains for known providers.
 * Maps provider names to their canonical domain for proper favicon resolution.
 * This fixes issues like api.gmail.com returning a globe icon instead of Gmail logo.
 */
/**
 * Direct icon URLs for providers that need explicit URLs.
 * These take precedence over domain-based favicon fetching.
 */
export const PROVIDER_ICON_URLS: Record<string, string> = {
  // Docs and Sheets need direct URLs - their domains return generic Google logo
  docs: 'https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico',
  sheets: 'https://ssl.gstatic.com/docs/spreadsheets/favicon3.ico',
  // Microsoft services need direct URLs - Microsoft domains return generic favicons
  outlook: 'https://res.cdn.office.net/files/fabric-cdn-prod_20241209.001/assets/brand-icons/product/svg/outlook_48x1.svg',
  'microsoft-calendar': 'https://res.cdn.office.net/files/fabric-cdn-prod_20241209.001/assets/brand-icons/product/svg/outlook_48x1.svg',
  teams: 'https://res.cdn.office.net/files/fabric-cdn-prod_20241209.001/assets/brand-icons/product/svg/teams_48x1.svg',
  sharepoint: 'https://res.cdn.office.net/files/fabric-cdn-prod_20241209.001/assets/brand-icons/product/svg/sharepoint_48x1.svg',
};

/**
 * Static canonical domains for known providers (immutable).
 * Maps provider names to their canonical domain for proper favicon resolution.
 */
const STATIC_PROVIDER_DOMAINS: Readonly<Record<string, string>> = Object.freeze({
  // Google services - map both short names and full slugs
  'gmail': 'mail.google.com',
  'google-calendar': 'calendar.google.com',
  'calendar': 'calendar.google.com',
  'google-drive': 'drive.google.com',
  'drive': 'drive.google.com',
  'google-docs': 'docs.google.com',
  'google-sheets': 'sheets.google.com',
  // Microsoft services
  'outlook': 'outlook.live.com',
  'microsoft-calendar': 'outlook.live.com',
  'onedrive': 'onedrive.live.com',
  'teams': 'teams.microsoft.com',
  'sharepoint': 'sharepoint.com',
  // Common MCP providers - their MCP URLs differ from their main domain
  'github': 'github.com',
  'linear': 'linear.app',
  'slack': 'slack.com',
  'notion': 'notion.so',
});

/**
 * Cache structure for persisted provider domains
 */
interface ProviderDomainsCache {
  version: 1;
  domains: Record<string, string>;
  updatedAt: number;
}

/**
 * Load cached provider domains from filesystem
 */
function loadProviderDomainsCache(): Record<string, string> {
  try {
    if (!existsSync(PROVIDER_DOMAINS_CACHE_PATH)) return {};
    const cache = readJsonFileSync<ProviderDomainsCache>(PROVIDER_DOMAINS_CACHE_PATH);
    return cache.domains || {};
  } catch {
    return {};
  }
}

/**
 * Memoized merged provider domains (module-private).
 * Merges user-cached domains with static domains on first access.
 */
let _mergedProviderDomains: Record<string, string> | null = null;

/**
 * Get canonical domain for a provider.
 * Merges static domains with user-cached domains (static takes precedence).
 *
 * @param provider - Provider name (case-insensitive)
 * @returns Canonical domain or undefined if not found
 */
export function getProviderDomain(provider: string): string | undefined {
  if (!_mergedProviderDomains) {
    const cached = loadProviderDomainsCache();
    _mergedProviderDomains = { ...cached, ...STATIC_PROVIDER_DOMAINS };
    if (Object.keys(cached).length > 0) {
      debug(`[logo] Loaded ${Object.keys(cached).length} cached provider domains`);
    }
  }
  return _mergedProviderDomains[provider.toLowerCase()];
}

/**
 * Reset the provider domain cache (for testing).
 * Allows tests to clear cached state between test cases.
 */
export function _resetProviderDomainCache(): void {
  _mergedProviderDomains = null;
}

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Extract root domain from hostname (strips subdomains like api., www., etc.)
 * e.g., "api.github.com" -> "github.com"
 *       "mcp.linear.app" -> "linear.app"
 */
export function extractRootDomain(hostname: string): string {
  const parts = hostname.split('.');

  // Handle special TLDs like .co.uk, .com.au, etc.
  const specialTlds = ['co.uk', 'com.au', 'co.nz', 'co.jp', 'com.br', 'co.in'];
  const lastTwo = parts.slice(-2).join('.');

  if (specialTlds.includes(lastTwo) && parts.length > 2) {
    // Return last 3 parts: example.co.uk
    return parts.slice(-3).join('.');
  }

  // Return last 2 parts: github.com
  if (parts.length >= 2) {
    return parts.slice(-2).join('.');
  }

  return hostname;
}

/**
 * Get logo URL for a service (synchronous, uses Google Favicon API)
 * Returns Google Favicon URL or null for internal domains.
 *
 * @param serviceUrl - The service URL to get logo for
 * @param provider - Optional provider name (e.g., 'gmail') to use canonical domain mapping
 */
export function getLogoUrl(serviceUrl: string, provider?: string): string | null {
  // Check if provider has a direct icon URL (highest priority)
  if (provider) {
    const directIconUrl = PROVIDER_ICON_URLS[provider.toLowerCase()];
    if (directIconUrl) {
      return directIconUrl;
    }

    // Check if provider has a canonical domain mapping
    const canonicalDomain = getProviderDomain(provider);
    if (canonicalDomain) {
      return `${GOOGLE_FAVICON_URL}128&url=https://${canonicalDomain}`;
    }
  }

  const fullDomain = extractDomain(serviceUrl);
  if (!fullDomain) {
    return null;
  }

  // Skip internal domains
  if (fullDomain === 'localhost' || fullDomain.endsWith('.local') || /^[\d.]+$/.test(fullDomain)) {
    return null;
  }

  // Extract root domain (strips subdomains like api., www., etc.)
  const rootDomain = extractRootDomain(fullDomain);

  // Return Google Favicon V2 URL - browser handles caching
  return `${GOOGLE_FAVICON_URL}128&url=https://${rootDomain}`;
}
