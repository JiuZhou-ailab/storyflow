// input: Project/global Source origin and Host local-MCP setting
// output: Connection-state projection for local stdio execution
// pos: Regression coverage for renderer/runtime trust-boundary parity

import { describe, expect, it } from 'bun:test'
import { isProjectStdioSourceDisabled } from '../../lib/source-execution'

const stdioSource = (origin: 'workspace' | 'craft-global') => ({
  origin,
  config: { type: 'mcp', mcp: { transport: 'stdio', authType: 'none' } },
})

describe('project stdio Source status', () => {
  it('shows a Project Source as disabled without a Host grant', () => {
    const source = stdioSource('workspace')
    expect(isProjectStdioSourceDisabled(source, false)).toBe(true)
  })

  it('keeps a global Source available under its existing trust contract', () => {
    const source = stdioSource('craft-global')
    expect(isProjectStdioSourceDisabled(source, false)).toBe(false)
  })
})
