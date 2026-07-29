// input: AccountCenterPage source
// output: Static regression coverage for the avatar-opened factual account surface
// pos: Keeps account management separate from post-login project routing

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../AccountCenterPage.tsx', import.meta.url), 'utf8')

describe('AccountCenterPage', () => {
  it('presents factual account information without acting as a startup handoff', () => {
    expect(source).toContain('>账户</h1>')
    expect(source).toContain('ClientAuthUser')
    expect(source).toContain('登录方式')
    expect(source).toContain('邮箱状态')
    expect(source).not.toContain('积分')
    expect(source).not.toContain('订阅')
    expect(source).not.toContain('待同步')
    expect(source).not.toContain('进入项目中心')
    expect(source).not.toContain('onContinue')
  })

  it('keeps account actions scoped to account management', () => {
    expect(source).toContain('onBack')
    expect(source).toContain('onSignedIn')
    expect(source).toContain('onSignOut')
    expect(source).toContain('退出登录')
    expect(source).toContain('ClientSignInForm')
  })
})
