// input: Real Source files, local MCP endpoint, and session callback bindings
// output: Explicit source_test clears only its source's connection backoff
// pos: Integration guard across session tools and the runtime MCP pool
import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleSourceTest } from '@craft-agent/session-tools-core';
import { createSessionToolContext } from '../../../../shared/src/agent/session-tool-context';
import { attachSessionSelfManagementBindings } from '../../../../shared/src/agent/session-self-management-bindings';
import { registerSessionScopedToolCallbacks, unregisterSessionScopedToolCallbacks } from '../../../../shared/src/agent/session-scoped-tool-callback-registry';
import { McpClientPool } from '../mcp-pool';

test('explicit source_test clears its backoff even when validation fails and autoEnable is false', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mcp-source-retry-'));
  const sessionId = root;
  const counts = new Map<string, number>();
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    counts.set(path, (counts.get(path) ?? 0) + 1);
    return new Response('unavailable', { status: 503 });
  } });
  const pool = new McpClientPool();
  const config = (slug: string) => ({ type: 'http' as const, url: new URL(slug, server.url).href, capabilityRef: slug });
  const configs = { target: config('target'), other: config('other') };
  mkdirSync(join(root, 'sources', 'target'), { recursive: true });
  writeFileSync(join(root, 'sources', 'target', 'config.json'), JSON.stringify({
    id: 'target', slug: 'target', name: 'Target', type: 'mcp', enabled: true, provider: 'test',
    mcp: { transport: 'http', url: configs.target.url, authType: 'none' },
  }));
  const context = createSessionToolContext({ sessionId, workspacePath: root, workspaceId: 'test',
    onPlanSubmitted() {}, onAuthRequest() {}, getHostGrantedSourceRefs: () => null,
    getHostAllowsProjectStdio: () => false,
  });
  attachSessionSelfManagementBindings(context, sessionId);
  registerSessionScopedToolCallbacks(sessionId, { clearSourceBackoffFn: slug => pool.clearBackoff(slug) });
  try {
    await pool.sync(configs);
    await handleSourceTest(context, { sourceSlug: 'target', autoEnable: false });
    const before = counts.get('/target')!;
    await pool.sync(configs);
    expect(counts.get('/target')).toBe(before + 1);
    expect(counts.get('/other')).toBe(1);
  } finally {
    unregisterSessionScopedToolCallbacks(sessionId);
    await pool.disconnectAll();
    server.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
});
