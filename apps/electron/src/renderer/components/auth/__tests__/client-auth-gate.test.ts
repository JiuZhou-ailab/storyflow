// input: Client auth gate source
// output: Static regression coverage for the login screen hierarchy
// pos: Keeps Feishu and password login from competing as equal primary actions

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../ClientAuthGate.tsx', import.meta.url), 'utf8')

describe('ClientAuthGate layout', () => {
  it('renders password login first and keeps Feishu as the bottom alternative entry', () => {
    const formIndex = source.indexOf('<form className="space-y-3"')
    const feishuIndex = source.indexOf('使用飞书登录')

    expect(formIndex).toBeGreaterThan(-1)
    expect(feishuIndex).toBeGreaterThan(formIndex)
    expect(source).toContain('或使用飞书')
    expect(source).toContain("variant={emailPasswordEnabled ? 'outline' : 'default'}")
    expect(source).not.toContain('其他登录方式')
  })
})
