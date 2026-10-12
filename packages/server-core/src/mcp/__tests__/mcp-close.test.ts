import { test, expect } from 'bun:test'
import { ChildProcess } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpClientPool } from '../mcp-pool'

for (const blocked of [false, true]) test(`MCP close confirms exit and retries pending cleanup (blocked=${blocked})`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'storyflow-mcp-close-'))
  const file = join(root, 'server.cjs')
  writeFileSync(file, `
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
    require('node:readline').createInterface({input:process.stdin}).on('line', line => {
      const m = JSON.parse(line); if (m.id === undefined) return;
      const result = m.method === 'initialize' ? {protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}
        : m.method === 'tools/list' ? {tools:[{name:'pid',inputSchema:{type:'object'}}]}
        : {content:[{type:'text',text:String(process.pid)}]};
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
    });
  `)
  const pool = new McpClientPool()
  let pid: number | undefined
  let blockedChild: ChildProcess | undefined
  const kill = ChildProcess.prototype.kill
  try {
    await pool.connect('fixture', { type: 'stdio', command: process.execPath, args: [file], capabilityRef: 'fixture:pid' })
    const result = await pool.callTool('mcp__fixture__pid', {})
    pid = Number(result.content)
    expect(pid).toBeGreaterThan(0)
    if (blocked) {
      // Fault only the owned child's OS signal boundary; the SDK and pool remain real.
      ChildProcess.prototype.kill = function(signal) {
        if (this.pid === pid) { blockedChild = this; return false }
        return kill.call(this, signal)
      }
      await expect(pool.disconnectAll()).rejects.toThrow('MCP clients failed to close')
      expect(blockedChild).toBeDefined()
      ChildProcess.prototype.kill = kill
      // External recovery of a process the OS previously refused to stop.
      kill.call(blockedChild!, 'SIGKILL')
    }
    await pool.disconnectAll()
    expect(() => process.kill(pid!, 0)).toThrow()
  } finally {
    ChildProcess.prototype.kill = kill
    if (blockedChild) kill.call(blockedChild, 'SIGKILL')
    else if (pid) { try { process.kill(pid, 'SIGKILL') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error } }
    await pool.disconnectAll()
    rmSync(root, {recursive:true,force:true})
  }
}, 15_000)

test('connection timeout releases a subprocess that never initializes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'storyflow-mcp-timeout-'))
  const pidPath = join(root, 'pid')
  const file = join(root, 'server.cjs')
  writeFileSync(file, `
    require('node:fs').writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
    process.stdin.resume();
    process.stdin.on('end', () => process.exit(0));
    setInterval(() => {}, 1000);
  `)
  const pool = new McpClientPool()
  let pid: number | undefined
  try {
    const connecting = pool.sync({ hanging: { type: 'stdio', command: process.execPath, args: [file], capabilityRef: 'hanging' } })
    for (let n = 0; n < 100 && !await Bun.file(pidPath).exists(); n++) await Bun.sleep(10)
    pid = Number(await Bun.file(pidPath).text())
    expect(pid).toBeGreaterThan(0)
    expect(await connecting).toEqual(['hanging'])
    expect(pool.isConnected('hanging')).toBe(false)
    expect(() => process.kill(pid!, 0)).toThrow()
  } finally {
    if (pid) { try { process.kill(pid, 'SIGKILL') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error } }
    await pool.disconnectAll()
    rmSync(root, { recursive: true, force: true })
  }
}, 20_000)

test('a failed close cannot release sync ownership while another source is connecting', async () => {
  const root = mkdtempSync(join(tmpdir(), 'storyflow-mcp-drain-'))
  const file = join(root, 'server.cjs')
  writeFileSync(file, `
    process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);
    require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
      const m = JSON.parse(line); if (m.id === undefined) return;
      const result = m.method === 'initialize' ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
        : m.method === 'tools/list' ? { tools: [{ name: 'pid', inputSchema: { type: 'object' } }] }
        : { content: [{ type: 'text', text: String(process.pid) }] };
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n');
    });
  `)
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method !== 'POST') return new Response(null, { status: 405 })
    const m = await request.json() as { id?: number; method: string }
    if (m.id === undefined) return new Response(null, { status: 202 })
    if (m.method === 'initialize') await Bun.sleep(6_000)
    return Response.json({ jsonrpc: '2.0', id: m.id, result: m.method === 'initialize'
      ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'slow', version: '1' } }
      : { tools: [] } })
  } })
  const pool = new McpClientPool()
  const config = { type: 'stdio' as const, command: process.execPath, args: [file], capabilityRef: 'old' }
  const kill = ChildProcess.prototype.kill
  let pid: number | undefined
  try {
    await pool.sync({ blocked: config })
    pid = Number((await pool.callTool('mcp__blocked__pid', {})).content)
    ChildProcess.prototype.kill = function(signal) { return this.pid === pid ? false : kill.call(this, signal) }
    await expect(pool.sync({ blocked: { ...config, capabilityRef: 'new' }, slow: {
      type: 'http', url: server.url.href, capabilityRef: 'slow',
    } })).rejects.toThrow()
    ChildProcess.prototype.kill = kill
    process.kill(pid, 'SIGKILL')
    await pool.disconnectAll()
    await Bun.sleep(1_500)
    expect(pool.getConnectedSlugs()).toEqual([])
  } finally {
    ChildProcess.prototype.kill = kill
    if (pid) { try { process.kill(pid, 'SIGKILL') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error } }
    await pool.disconnectAll()
    server.stop(true)
    rmSync(root, { recursive: true, force: true })
  }
}, 15_000)
