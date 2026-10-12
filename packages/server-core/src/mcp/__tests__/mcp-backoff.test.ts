// input: Real local HTTP MCP endpoints and the public pool interface
// output: Retry, concurrency, and connection deadline regression coverage
// pos: Source connection lifecycle acceptance tests
import { expect, test, spyOn } from 'bun:test';
import { McpClientPool } from '../mcp-pool';

function failingServer(delay = 80) {
  let attempts = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    async fetch() {
      attempts++;
      await Bun.sleep(delay);
      return new Response('unavailable', { status: 503 });
    },
  });
  return {
    server,
    attempts: () => attempts,
    config: { type: 'http' as const, url: server.url.href, capabilityRef: 'workspace:fixture:1' },
  };
}

test('unchanged failed sources are skipped on the next sync and retain their failure', async () => {
  const endpoint = failingServer();
  const logs: string[] = [];
  const pool = new McpClientPool({ debug: message => logs.push(message) });
  try {
    expect(await pool.sync({ failed: endpoint.config })).toEqual(['failed']);
    const attempts = endpoint.attempts();
    const start = performance.now();
    expect(await pool.sync({ failed: { ...endpoint.config } })).toEqual(['failed']);
    expect(endpoint.attempts()).toBe(attempts);
    expect(performance.now() - start).toBeLessThan(60);
    expect(logs.at(-1)).toContain('unavailable');
  } finally {
    await pool.disconnectAll();
    endpoint.server.stop(true);
  }
});

test('sources start in parallel and finish within one slow connection', async () => {
  const endpoint = failingServer(150);
  const pool = new McpClientPool();
  try {
    const start = performance.now();
    const syncing = pool.sync({ one: endpoint.config, two: endpoint.config, three: endpoint.config });
    await Bun.sleep(50);
    expect(endpoint.attempts()).toBe(3);
    expect(await syncing).toEqual(['one', 'two', 'three']);
    expect(performance.now() - start).toBeLessThan(350);
  } finally {
    await pool.disconnectAll();
    endpoint.server.stop(true);
  }
});

test('one deadline covers initialization plus tool discovery and aborts the HTTP request', async () => {
  let aborted = false;
  let listing = false;
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    async fetch(request) {
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      const message = await request.json() as { id?: number; method: string };
      if (message.id === undefined) return new Response(null, { status: 202 });
      request.signal.addEventListener('abort', () => { aborted = true; });
      if (message.method === 'tools/list') listing = true;
      await Bun.sleep(8_000);
      return Response.json({ jsonrpc: '2.0', id: message.id, result: message.method === 'initialize'
        ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'slow', version: '1' } }
        : { tools: [] } });
    },
  });
  const pool = new McpClientPool();
  try {
    const start = performance.now();
    expect(await pool.sync({ slow: { type: 'http', url: server.url.href, capabilityRef: 'slow' } })).toEqual(['slow']);
    expect(listing).toBe(true);
    expect(performance.now() - start).toBeLessThan(17_000);
    await Bun.sleep(50);
    expect(aborted).toBe(true);
    expect(pool.isConnected('slow')).toBe(false);
  } finally {
    await pool.disconnectAll();
    server.stop(true);
  }
}, 30_000);

test('explicit retries and changed credentials bypass only the affected source backoff', async () => {
  const endpoint = failingServer(1);
  const pool = new McpClientPool();
  try {
    const configs = { one: endpoint.config, two: endpoint.config };
    await pool.sync(configs);
    pool.clearBackoff('one');
    await pool.sync(configs);
    expect(endpoint.attempts()).toBe(3);
    await pool.sync({ ...configs, one: { ...endpoint.config, headers: { 'X-Api-Key': 'updated' } } });
    expect(endpoint.attempts()).toBe(4);
    await pool.disconnect('two');
    await pool.sync(configs);
    expect(endpoint.attempts()).toBe(6);
    await pool.sync({});
    await pool.sync(configs);
    expect(endpoint.attempts()).toBe(8);
  } finally {
    await pool.disconnectAll();
    endpoint.server.stop(true);
  }
});


test('automatic retries use bounded exponential backoff', async () => {
  const endpoint = failingServer(1);
  const pool = new McpClientPool();
  let now = Date.now();
  const clock = spyOn(Date, 'now').mockImplementation(() => now);
  try {
    await pool.sync({ failed: endpoint.config });
    for (const delay of [30_000, 60_000, 120_000, 240_000, 480_000, 600_000, 600_000]) {
      const attempts = endpoint.attempts();
      now += delay - 1;
      await pool.sync({ failed: endpoint.config });
      expect(endpoint.attempts()).toBe(attempts);
      now++;
      await pool.sync({ failed: endpoint.config });
      expect(endpoint.attempts()).toBe(attempts + 1);
    }
  } finally {
    clock.mockRestore();
    await pool.disconnectAll();
    endpoint.server.stop(true);
  }
});

test('overlapping syncs share the failed attempt instead of spawning duplicate clients', async () => {
  const endpoint = failingServer();
  const pool = new McpClientPool();
  try {
    const results = await Promise.all([
      pool.sync({ failed: endpoint.config }),
      pool.sync({ failed: endpoint.config }),
    ]);
    expect(results).toEqual([['failed'], ['failed']]);
    expect(endpoint.attempts()).toBe(1);
  } finally {
    await pool.disconnectAll();
    endpoint.server.stop(true);
  }
});

test('explicit reset during an attempt is not overwritten by its late failure', async () => {
  const endpoint = failingServer();
  const pool = new McpClientPool();
  try {
    const syncing = pool.sync({ failed: endpoint.config });
    await Bun.sleep(30);
    pool.clearBackoff('failed');
    await syncing;
    await pool.sync({ failed: endpoint.config });
    expect(endpoint.attempts()).toBe(2);
  } finally {
    await pool.disconnectAll();
    endpoint.server.stop(true);
  }
});

test('a recovered source publishes usable tools before a slow sibling finishes', async () => {
  let available = false;
  let attempts = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    const m = await request.json() as { id?: number; method: string };
    if (m.id === undefined) return new Response(null, { status: 202 });
    if (m.method === 'initialize') attempts++;
    if (!available) return new Response('unavailable', { status: 503 });
    return Response.json({ jsonrpc: '2.0', id: m.id, result: m.method === 'initialize'
      ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'recovered', version: '1' } }
      : m.method === 'tools/list' ? { tools: [{ name: 'ping', inputSchema: { type: 'object' } }] }
      : { content: [{ type: 'text', text: 'pong' }] } });
  } });
  const slow = failingServer(300);
  const pool = new McpClientPool();
  const config = { type: 'http' as const, url: server.url.href, capabilityRef: 'recovered' };
  let now = Date.now();
  const clock = spyOn(Date, 'now').mockImplementation(() => now);
  let syncing: Promise<string[]> | undefined;
  try {
    await pool.sync({ recovered: config });
    now += 30_000;
    await pool.sync({ recovered: config });
    available = true;
    now += 60_000;
    syncing = pool.sync({ slow: slow.config, recovered: config });
    await Bun.sleep(80);
    expect(pool.isConnected('recovered')).toBe(true);
    expect((await pool.callTool('mcp__recovered__ping', {})).content).toBe('pong');
    expect(await syncing).toEqual(['slow']);
    expect(await pool.sync({ recovered: config })).toEqual([]);
    expect(attempts).toBe(3);
    // A new failure after success starts again at the initial delay.
    await pool.disconnect('recovered');
    available = false;
    await pool.sync({ recovered: config });
    now += 30_000;
    await pool.sync({ recovered: config });
    expect(attempts).toBe(5);
  } finally {
    await syncing;
    clock.mockRestore();
    await pool.disconnectAll();
    server.stop(true);
    slow.server.stop(true);
  }
});
