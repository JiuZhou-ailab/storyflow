// input: MCP/API server configs, proxy tool calls, and session output boundaries.
// output: Source clients, proxy tools, normalized results, and per-source failure backoff.
// pos: Main-process connection pool between Product Host and external Sources; satisfies McpClientPoolLike from shared.

/**
 * Centralized MCP Client Pool
 *
 * Owns all MCP source connections in the main Electron process.
 * All backends (Claude, Pi) receive proxy tool definitions
 * and route tool calls through this pool instead of managing MCP connections
 * themselves.
 *
 * Benefits:
 * - One MCP code path for all backends
 * - Shared clients across sessions (e.g., same Linear connection)
 * - No credential cache files — main process has direct access
 * - Runtime source switching without session restart
 */

import { isDeepStrictEqual } from 'node:util';
import { CraftMcpClient } from './client.ts';
import { ApiSourcePoolClient } from './api-source-pool-client.ts';
import type {
  ApiServerConfig,
  McpClientConfig,
  McpToolResult,
  PoolClient,
  ProxyToolDef,
  SdkMcpServerConfig,
} from '@craft-agent/shared/mcp';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ApiToolPermissionDefinition, ApiToolPermission } from '@craft-agent/shared/sources/types';
import { guardLargeResult } from '@craft-agent/shared/utils';
import {
  saveBinaryResponse,
  detectExtensionFromMagic,
  sanitizeFilename,
} from '@craft-agent/shared/utils/binary-detection';
import { canonicalizeApiPath, materializeApiOperationRequest } from '@craft-agent/shared/sources';

// Avoid retrying unavailable sources on every turn while still probing recovery.
// Bound the entire handshake and discovery, not each SDK request separately.
const CONNECT_TIMEOUT_MS = 15_000;
const RETRY_INITIAL_MS = 30_000;
const RETRY_MAX_MS = 10 * 60_000;

export class McpClientPool {
  private syncPending: Promise<void> = Promise.resolve();
  private failures = new Map<string, {
    config: SdkMcpServerConfig;
    attempts: number;
    retryAt: number;
    reason: string;
  }>();

  /** Explicit user retries bypass automatic connection backoff. */
  clearBackoff(slug: string): void {
    this.failures.delete(slug);
  }

  /** Active MCP clients keyed by source slug */
  private clients = new Map<string, PoolClient>();

  /** Retain ownership when failed-connection cleanup needs another attempt. */
  private pendingCleanup = new Map<string, PoolClient>();

  /** Configs used for active MCP connections (for change detection during sync) */
  protected activeConfigs = new Map<string, SdkMcpServerConfig>();

  /** Exact Source capability bound to each connected client. */
  protected activeCapabilityRefs = new Map<string, string>();

  /** Cached tool lists keyed by source slug */
  private toolCache = new Map<string, Tool[]>();

  /** Proxy tool name → { slug, originalName } (e.g., "mcp__linear__createIssue" → { slug: "linear", originalName: "createIssue" }) */
  private proxyTools = new Map<string, { slug: string; originalName: string; capabilityRef: string }>();

  /** Host-owned HTTP semantics for declarative in-process API tools. */
  private proxyToolPermissions = new Map<string, ApiToolPermissionDefinition>();

  /** Optional debug logger */
  private debugFn: ((msg: string) => void) | undefined;

  /** Session storage path for saving large responses */
  private sessionPath?: string;

  /** Summarize callback for large response handling */
  private summarizeCallback?: (prompt: string) => Promise<string | null>;

  /** Called after sync() connects/disconnects sources, so clients can be notified */
  onToolsChanged?: () => void;

  constructor(options?: { debug?: (msg: string) => void; sessionPath?: string }) {
    this.debugFn = options?.debug;
    this.sessionPath = options?.sessionPath;
  }

  /**
   * Set the summarize callback for large response handling.
   * Typically called after agent creation: pool.setSummarizeCallback(agent.getSummarizeCallback())
   */
  setSummarizeCallback(fn: (prompt: string) => Promise<string | null>): void {
    this.summarizeCallback = fn;
  }

  private debug(msg: string): void {
    this.debugFn?.(`[McpClientPool] ${msg}`);
  }

  // ============================================================
  // Connection Lifecycle
  // ============================================================

  /**
   * Register a client: connect, cache tools, build proxy mappings.
   * Shared logic for both remote MCP and in-process API sources.
   */
  protected async registerClient(slug: string, capabilityRef: string, client: PoolClient): Promise<void> {
    // listTools() triggers connect() internally for both CraftMcpClient and ApiSourcePoolClient
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tools: Tool[];
    try {
      tools = await Promise.race([
        client.listTools(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`MCP connection timed out after ${CONNECT_TIMEOUT_MS}ms`)), CONNECT_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      this.pendingCleanup.set(slug, client);
      try {
        await client.close();
        this.pendingCleanup.delete(slug);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'MCP connection and cleanup failed');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
    this.clients.set(slug, client);
    this.activeCapabilityRefs.set(slug, capabilityRef);
    this.toolCache.set(slug, tools);

    for (const tool of tools) {
      const proxyName = `mcp__${slug}__${tool.name}`;
      this.proxyTools.set(proxyName, { slug, originalName: tool.name, capabilityRef });
    }

    this.debug(`Connected source ${slug}: ${tools.length} tools`);
  }

  /**
   * Connect to an MCP source server (remote HTTP/SSE/stdio).
   * If already connected, this is a no-op.
   */
  async connect(slug: string, config: SdkMcpServerConfig): Promise<void> {
    this.clearBackoff(slug);
    if (this.clients.has(slug)) return;
    if (this.pendingCleanup.has(slug)) await this.disconnect(slug);
    const clientConfig = sdkConfigToClientConfig(config);
    if (!clientConfig) {
      this.debug(`Unknown MCP server type for ${slug}: ${(config as { type: string }).type}`);
      return;
    }
    await this.registerClient(slug, config.capabilityRef, new CraftMcpClient(clientConfig));
    this.activeConfigs.set(slug, config);
  }

  /**
   * Connect to an in-process MCP server (API source) via in-memory transport.
   */
  async connectInProcess(slug: string, config: ApiServerConfig): Promise<void> {
    if (this.clients.has(slug)) return;
    if (this.pendingCleanup.has(slug)) await this.disconnect(slug);
    await this.registerClient(slug, config.capabilityRef, new ApiSourcePoolClient(config.instance));
    for (const [toolName, permission] of Object.entries(config.toolPermissions ?? {})) {
      this.proxyToolPermissions.set(`mcp__${slug}__${toolName}`, permission);
    }
  }

  /**
   * Disconnect a source and remove its tools from the pool.
   */
  async disconnect(slug: string): Promise<void> {
    this.clearBackoff(slug);
    const client = this.clients.get(slug) ?? this.pendingCleanup.get(slug);
    if (client) {
      await client.close();
      this.clients.delete(slug);
      this.pendingCleanup.delete(slug);
    }

    // Remove proxy tool entries for this slug
    for (const [proxyName, info] of this.proxyTools) {
      if (info.slug === slug) {
        this.proxyTools.delete(proxyName);
        this.proxyToolPermissions.delete(proxyName);
      }
    }
    this.toolCache.delete(slug);
    this.activeConfigs.delete(slug);
    this.activeCapabilityRefs.delete(slug);
    this.debug(`Disconnected source: ${slug}`);
  }

  /**
   * Disconnect all sources and clear all state.
   */
  async disconnectAll(): Promise<void> {
    await this.syncPending;
    this.failures.clear();
    const results = await Promise.allSettled([...new Set([...this.clients.keys(), ...this.pendingCleanup.keys()])].map(slug => this.disconnect(slug)));
    const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (errors.length) throw new AggregateError(errors.map(result => result.reason), 'MCP clients failed to close');
    this.debug('Disconnected all MCP clients');
  }

  // ============================================================
  // Sync: Reconcile active sources
  // ============================================================

  /**
   * Sync the pool to match a desired set of MCP + API sources.
   * Connects new sources, disconnects removed ones, keeps existing ones.
   *
   * @param mcpServers - Map of slug → config for desired MCP sources
   * @param apiServers - Map of slug → config for desired API sources
   * @returns List of slugs that failed to connect
   */
  async sync(
    mcpServers: Record<string, SdkMcpServerConfig>,
    apiServers: Record<string, ApiServerConfig> = {}
  ): Promise<string[]> {
    // Reconcile calls in order; sources within each reconciliation connect in parallel.
    const result = this.syncPending.then(() => this.syncSources(mcpServers, apiServers));
    this.syncPending = result.then(() => {}, () => {});
    return result;
  }

  private async syncSources(
    mcpServers: Record<string, SdkMcpServerConfig>,
    apiServers: Record<string, ApiServerConfig>,
  ): Promise<string[]> {
    // Extract McpServer instances from API configs
    const apiSlugs = new Map<string, ApiServerConfig>();
    for (const [slug, config] of Object.entries(apiServers)) {
      if (config?.type === 'sdk' && config.instance) {
        apiSlugs.set(slug, config);
      }
    }

    const desiredSlugs = new Set([...Object.keys(mcpServers), ...apiSlugs.keys()]);
    const currentSlugs = new Set([...this.clients.keys(), ...this.pendingCleanup.keys()]);

    // Disconnect sources no longer desired
    for (const slug of currentSlugs) {
      if (!desiredSlugs.has(slug)) {
        await this.disconnect(slug);
      }
    }

    for (const slug of this.failures.keys()) {
      if (!Object.hasOwn(mcpServers, slug)) this.clearBackoff(slug);
    }

    // Connect new MCP sources and reconnect changed credentials.
    const mcpResults = Promise.allSettled(Object.entries(mcpServers).filter(([slug]) => !apiSlugs.has(slug)).map(async ([slug, config]) => {
      const failure = this.failures.get(slug);
      const unchanged = failure && isDeepStrictEqual(failure.config, config);
      if (unchanged && Date.now() < failure.retryAt) {
        this.debug(`Skipping MCP source ${slug} until ${new Date(failure.retryAt).toISOString()}: ${failure.reason}`);
        return slug;
      }
      if (failure && !unchanged) this.clearBackoff(slug);
      const oldConfig = this.activeConfigs.get(slug);
      if (this.clients.has(slug)) {
        if (this.activeCapabilityRefs.get(slug) === config.capabilityRef
          && (!oldConfig || !mcpConfigChanged(oldConfig, config))) return;
        await this.disconnect(slug);
      }
      const attempts = unchanged ? failure.attempts + 1 : 1;
      const attempt = { config: structuredClone(config), attempts, retryAt: 0, reason: '' };
      try {
        const connecting = this.connect(slug, config);
        this.failures.set(slug, attempt);
        await connecting;
        if (this.failures.get(slug) === attempt) this.clearBackoff(slug);
      } catch (err) {
        const delay = Math.min(RETRY_MAX_MS, RETRY_INITIAL_MS * 2 ** Math.min(attempts - 1, 5));
        const reason = err instanceof Error ? err.message : String(err);
        // An explicit retry during this attempt must survive its late failure.
        if (this.failures.get(slug) === attempt) {
          attempt.retryAt = Date.now() + delay;
          attempt.reason = reason;
        }
        this.debug(`Failed to connect MCP source ${slug}: ${reason}`);
        return slug;
      }
    }));

    // Declarative API clients close over resolved credentials. Replacing the
    // in-process instance is cheap and ensures a refresh cannot retain them.
    const apiResults = Promise.allSettled([...apiSlugs].map(async ([slug, config]) => {
      if (this.clients.has(slug)) await this.disconnect(slug);
      if (!this.clients.has(slug)) {
        try {
          await this.connectInProcess(slug, config);
        } catch (err) {
          this.debug(`Failed to connect API source ${slug}: ${err instanceof Error ? err.message : String(err)}`);
          return slug;
        }
      }
    }));

    // A failed close must not release the sync queue while sibling connections still run.
    const results = (await Promise.all([mcpResults, apiResults])).flat();
    this.onToolsChanged?.();
    const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (errors.length) throw new AggregateError(errors.map(result => result.reason), 'MCP sources failed to reconcile');
    return results.flatMap(result => result.status === 'fulfilled' && result.value !== undefined ? [result.value] : []);
  }

  // ============================================================
  // Tool Discovery
  // ============================================================

  /**
   * Get cached tools for a source. Returns empty array if not connected.
   */
  getTools(slug: string): Tool[] {
    return this.toolCache.get(slug) || [];
  }

  /**
   * Get all connected source slugs.
   */
  getConnectedSlugs(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Check if a source is connected.
   */
  isConnected(slug: string): boolean {
    return this.clients.has(slug);
  }

  /**
   * Generate proxy tool definitions for all connected sources (or a subset).
   * These are passed to backends for tool registration.
   */
  getProxyToolDefs(slugs?: string[]): ProxyToolDef[] {
    const targetSlugs = slugs || Array.from(this.toolCache.keys());
    const defs: ProxyToolDef[] = [];

    for (const slug of targetSlugs) {
      const tools = this.toolCache.get(slug) || [];
      for (const tool of tools) {
        // Strip $schema — AJV (Pi agent) fails on unregistered meta-schema URIs.
        // Same pattern as getToolDefsAsJsonSchema() in tool-defs.ts.
        const { $schema, ...cleanSchema } = (tool.inputSchema as Record<string, unknown>) || {};
        defs.push({
          name: `mcp__${slug}__${tool.name}`,
          description: tool.description || `Tool from ${slug}`,
          inputSchema: Object.keys(cleanSchema).length > 0 ? cleanSchema : { type: 'object', properties: {} },
        });
      }
    }

    return defs;
  }

  // ============================================================
  // Tool Execution
  // ============================================================

  /**
   * Execute an MCP tool by its proxy name (mcp__{slug}__{toolName}).
   * Returns a result matching the subprocess protocol format.
   */
  async callTool(proxyName: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const info = this.proxyTools.get(proxyName);
    if (!info) {
      return {
        content: `Unknown MCP proxy tool: ${proxyName}`,
        isError: true,
      };
    }

    const { slug, originalName } = info;

    const client = this.clients.get(slug);
    if (!client) {
      return {
        content: `MCP client for source "${slug}" is not connected.`,
        isError: true,
        sourceSlug: slug,
      };
    }

    try {
      const result = await client.callTool(originalName, args) as {
        content?: Array<{ type: string; text?: unknown; data?: string; mimeType?: string }>;
        isError?: boolean;
      };

      const contentBlocks = result.content || [];
      const parts: string[] = [];

      // 1. Process each content block — handle text, image, audio
      for (const block of contentBlocks) {
        if (block.type === 'text') {
          // Handle non-string text fields (e.g., objects from non-conforming servers)
          if (typeof block.text === 'string') {
            parts.push(block.text);
          } else if (block.text !== undefined && block.text !== null) {
            parts.push(JSON.stringify(block.text, null, 2));
          }
        } else if ((block.type === 'image' || block.type === 'audio') && block.data && this.sessionPath) {
          // Decode base64 binary content and save to downloads/
          try {
            const buffer = Buffer.from(block.data, 'base64');
            const ext = detectExtensionFromMagic(buffer) || '.bin';
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const safeName = sanitizeFilename(proxyName);
            const filename = `${safeName}_${timestamp}${ext}`;
            const saved = saveBinaryResponse(this.sessionPath, filename, buffer, block.mimeType ?? null);
            if (saved.type === 'file_download') {
              parts.push(`[${block.type.charAt(0).toUpperCase() + block.type.slice(1)} saved: ${saved.path} (${saved.sizeHuman})]`);
            }
          } catch {
            // Base64 decode failed — skip this block
          }
        }
      }

      // 2. Combine parts (fallback to JSON.stringify if no content extracted)
      const text = parts.join('\n') || JSON.stringify(result);

      // 3. Centralized binary + large response handling
      if (!result.isError && this.sessionPath) {
        const guarded = await guardLargeResult(text, {
          sessionPath: this.sessionPath,
          toolName: proxyName,
          input: args,
          summarize: this.summarizeCallback,
        });
        if (guarded) {
          return { content: guarded, isError: false };
        }
      }

      return {
        content: text,
        isError: !!result.isError,
      };
    } catch (err) {
      return {
        content: `MCP tool "${originalName}" (source: ${slug}) failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
        sourceSlug: slug,
      };
    }
  }

  /** Resolve a proxy through the pool's authoritative Source binding. */
  getProxyToolCapability(
    toolName: string,
  ): { sourceSlug: string; capabilityRef: string } | undefined {
    const info = this.proxyTools.get(toolName);
    return info
      ? { sourceSlug: info.slug, capabilityRef: info.capabilityRef }
      : undefined;
  }

  /** Resolve registered API semantics; Source identity always comes from the pool. */
  getProxyToolPermission(
    toolName: string,
    input: Record<string, unknown>,
  ): ApiToolPermission | undefined {
    const permission = this.proxyToolPermissions.get(toolName);
    const source = this.proxyTools.get(toolName);
    if (!permission || !source) return undefined;
    if ('kind' in permission) {
      // Only Host-registered flexible tools may supply their method and path.
      // Malformed requests fail closed here and are rejected by the MCP schema.
      if (typeof input.method !== 'string' || typeof input.path !== 'string') {
        return { sourceSlug: source.slug, method: 'INVALID', path: '/.storyflow/invalid-api-operation' };
      }
      return { sourceSlug: source.slug, method: input.method, path: canonicalizeApiPath(input.path) };
    }
    let path: string;
    try {
      path = materializeApiOperationRequest(
        permission.path,
        permission.parameters,
        input,
      ).path;
    } catch {
      // Missing path input must never turn the unresolved template into an
      // allowlist candidate. The MCP schema will reject the call itself.
      path = '/.storyflow/invalid-api-operation';
    }
    return { sourceSlug: source.slug, method: permission.method, path };
  }
}

/**
 * Convert SdkMcpServerConfig (used by backend types) to CraftMcpClient config.
 */
function sdkConfigToClientConfig(config: SdkMcpServerConfig): McpClientConfig | null {
  if (config.type === 'http' || config.type === 'sse') {
    return {
      transport: 'http',
      url: config.url,
      headers: config.headers,
    };
  }
  if (config.type === 'stdio') {
    return {
      transport: 'stdio',
      command: config.command,
      args: config.args,
      env: config.env,
    };
  }
  return null;
}

/**
 * Check if an MCP source's config has changed in a way that requires reconnection.
 * Compares auth headers (token refresh) and URL changes.
 * Ignores stdio sources since they don't use OAuth tokens.
 */
function mcpConfigChanged(oldConfig: SdkMcpServerConfig, newConfig: SdkMcpServerConfig): boolean {
  if (oldConfig.type !== newConfig.type) return true;

  if (
    (oldConfig.type === 'http' || oldConfig.type === 'sse') &&
    (newConfig.type === 'http' || newConfig.type === 'sse')
  ) {
    if (oldConfig.url !== newConfig.url) return true;
    const oldAuth = oldConfig.headers?.['Authorization'];
    const newAuth = newConfig.headers?.['Authorization'];
    if (oldAuth !== newAuth) return true;
  }

  return false;
}
