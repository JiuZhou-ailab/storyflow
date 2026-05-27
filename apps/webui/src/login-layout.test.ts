// input: Reads the static Web UI login document from disk.
// output: Verifies the login document keeps the expected responsive auth layout contract.
// pos: Regression coverage for the standalone Web UI login surface.
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const loginHtml = readFileSync(join(import.meta.dir, 'login.html'), 'utf8')

describe('webui login layout', () => {
  it('uses the same quiet app visual language as the workspace UI', () => {
    expect(loginHtml).toContain('class="login-shell"')
    expect(loginHtml).toContain('class="auth-card"')
    expect(loginHtml).toContain('class="auth-stack"')
    expect(loginHtml).toContain('oklch(0.98 0.003 265)')
    expect(loginHtml).toContain('oklch(0.62 0.13 293)')
    expect(loginHtml).not.toContain('class="brand-panel"')
    expect(loginHtml).not.toContain('A focused workspace for running agents against real projects.')
  })
})
