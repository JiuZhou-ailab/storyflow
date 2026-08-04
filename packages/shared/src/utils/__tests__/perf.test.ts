// input: Synthetic performance metric payloads
// output: Regression coverage for shared perf log formatting
// pos: Protects the log contract consumed by Electron performance QA tooling

import { describe, expect, it } from 'bun:test'
import { formatPerfMetric, type PerfMetric } from '../perf'

describe('perf utilities', () => {
  it('formats operation durations, marks, and metadata for log parsers', () => {
    const metric: PerfMetric = {
      name: 'rpc.file.read',
      startTime: 10,
      endTime: 15.25,
      duration: 5.25,
      marks: [
        { name: 'path.validated', time: 11, elapsed: 1 },
        { name: 'file.read', time: 15, elapsed: 5 },
      ],
      metadata: {
        file: 'outline.md',
        status: 'ok',
      },
    }

    const formatted = formatPerfMetric(metric)

    expect(formatted).toContain('[PERF] rpc.file.read: 5.25ms')
    expect(formatted).toContain('(path.validated:1.0ms → file.read:5.0ms)')
    expect(formatted).toContain('{"file":"outline.md","status":"ok"}')
    expect(formatted).not.toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
