// input: AccountCenterPage source
// output: Static regression coverage for the avatar-opened account and points surface
// pos: Keeps account management separate from post-login project routing

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../AccountCenterPage.tsx', import.meta.url), 'utf8')

describe('AccountCenterPage', () => {
  it('presents account information and points without acting as a startup handoff', () => {
    expect(source).toContain('账户中心')
    expect(source).toContain('积分')
    expect(source).toContain('订阅')
    expect(source).toContain('ClientAuthUser')
    expect(source).not.toContain('进入项目中心')
    expect(source).not.toContain('onContinue')
  })

  it('keeps account actions scoped to account management', () => {
    expect(source).toContain('onBack')
    expect(source).toContain('onSignOut')
    expect(source).toContain('退出登录')
  })
})
