// input: An isolated 6000-Session fixture and optional sample/profile/baseline settings
// output: Fresh-process disk-restoration samples and filesystem/parse/build/yield diagnostics
// pos: Local performance evidence for SessionPersistence; run under /tmp/perf/bench-lock.sh

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import type { ManagedSession } from './managed-session'
import { spyOn } from 'bun:test'

const fixture = process.env.CRAFT_CONFIG_DIR
assert(fixture, 'Set CRAFT_CONFIG_DIR to an isolated copy of the 6000-Session fixture')
const profile = process.env.SESSINIT_PROFILE === '1'

if (!process.argv.includes('--worker')) {
  const runs = Number(process.env.SESSINIT_RUNS ?? 10)
  assert(Number.isInteger(runs) && runs > 0)
  const samples = []
  for (let i = 0; i < runs; i++) {
    const child = Bun.spawnSync([process.execPath, import.meta.path, '--worker'], {
      env: process.env, stdout: 'pipe', stderr: 'pipe',
    })
    assert.equal(child.exitCode, 0, child.stderr.toString())
    const line = child.stdout.toString().split('\n').find(line => line.startsWith('SAMPLE='))
    assert(line, child.stdout.toString())
    samples.push(JSON.parse(line.slice(7)))
  }
  const percentile = (values: number[], p: number) => {
    const sorted = [...values].sort((a, b) => a - b)
    const position = (sorted.length - 1) * p
    const low = Math.floor(position), high = Math.ceil(position)
    return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low)
  }
  console.log(JSON.stringify({ fixture, runs, profile, samples,
    total: { p50: percentile(samples.map(s => s.totalMs), .5), p95: percentile(samples.map(s => s.totalMs), .95) },
    foreground: { p50: percentile(samples.map(s => s.foregroundMs), .5), p95: percentile(samples.map(s => s.foregroundMs), .95) },
  }, null, 2))
} else {
  const baselineStorage = process.env.SESSINIT_BASELINE_STORAGE
  let baselineLoaded = false
  if (baselineStorage) Bun.plugin({ name: 'session-init-baseline-storage', setup(builder) {
    builder.onLoad({ filter: /\/shared\/src\/sessions\/storage\.ts$/ }, () => {
      baselineLoaded = true
      return { contents: readFileSync(baselineStorage, 'utf8'), loader: 'ts' }
    })
  } })
  const metrics: Record<string, { calls: number; ms: number }> = {}
  let measuring = false
  let profileSyncFs = () => {}
  function record(name: string, start: number) {
    if (!measuring) return
    const metric = metrics[name] ??= { calls: 0, ms: 0 }
    metric.calls++
    metric.ms += performance.now() - start
  }
  if (profile) {
    const fs = await import('node:fs')
    profileSyncFs = () => {
      for (const name of ['existsSync', 'statSync', 'lstatSync', 'realpathSync', 'readdirSync', 'readFileSync'] as const) {
        const original = fs[name]
        spyOn(fs, name).mockImplementation(function (this: unknown, ...args: unknown[]) {
          const start = performance.now()
          try { return Reflect.apply(original, this, args) } finally { record(name, start) }
        })
      }
    }
    const promises = require('node:fs/promises')
    for (const name of ['readdir', 'open']) {
      const original = promises[name]
      promises[name] = async function (this: unknown, ...args: unknown[]) {
        const start = performance.now()
        try {
          const result = await original.apply(this, args)
          if (name === 'open') for (const method of ['read', 'close']) {
            const operation = result[method].bind(result)
            result[method] = async (...args: unknown[]) => {
              const start = performance.now()
              try { return await operation(...args) } finally { record(`header.${method}`, start) }
            }
          }
          return result
        } finally { record(name, start) }
      }
    }
    const parse = JSON.parse
    JSON.parse = (...args: Parameters<typeof JSON.parse>) => {
      const start = performance.now()
      try { return parse(...args) } finally { record('JSON.parse', start) }
    }
    const immediate = globalThis.setImmediate
    globalThis.setImmediate = ((callback: (...args: unknown[]) => void, ...args: unknown[]) => {
      const start = performance.now()
      return immediate(() => { record('yield', start); callback(...args) })
    }) as typeof setImmediate
    const globals = globalThis as typeof globalThis & { measureBuild?: (build: () => unknown) => unknown }
    globals.measureBuild = build => {
      const start = performance.now()
      try { return build() } finally { record('construct', start) }
    }
    Bun.plugin({ name: 'session-init-build-timing', setup(builder) {
      builder.onLoad({ filter: /\/sessions\/persistence\.ts$/ }, args => {
        const source = readFileSync(args.path, 'utf8')
        const contents = source.replace(/const managed = createManagedSession\(([^]*?)\n            \}\)/,
          'const managed = globalThis.measureBuild(() => createManagedSession($1\n            }))')
        assert.notEqual(source, contents, 'Construction probe no longer matches source')
        return { contents, loader: 'ts' }
      })
    } })
  }
  const { SessionPersistence } = await import('./persistence')
  assert(!baselineStorage || baselineLoaded, 'Baseline storage probe did not load')
  profileSyncFs()
  const config = JSON.parse(readFileSync(`${fixture}/config.json`, 'utf8'))
  const sessions = new Map<string, ManagedSession>()
  const persistence = new SessionPersistence({
    getSession: id => sessions.get(id), setSession: (id, session) => sessions.set(id, session),
    deleteSession: id => { sessions.delete(id) }, onQueuedRecovery() {},
    prepareBootServices: async () => {}, setInitialAutomationMetadata() {},
  })
  measuring = true
  const start = performance.now()
  let foregroundMs = 0
  const foreground = persistence.waitForInit(config.activeWorkspaceId).then(() => {
    foregroundMs = performance.now() - start
    assert.equal(sessions.size, 300, 'Active Project must become ready before background Projects')
  })
  await persistence.loadSessionsFromDisk()
  const totalMs = performance.now() - start
  measuring = false
  await foreground
  assert.equal(sessions.size, 6000)
  assert([...sessions.values()].every(session => !session.messagesLoaded && session.messages.length === 0))
  console.log('SAMPLE=' + JSON.stringify({ totalMs, foregroundMs, count: sessions.size, metrics }))
}
