// input: Client auth gate source
// output: Static regression coverage for the login screen hierarchy
// pos: Keeps Feishu and password login from competing as equal primary actions

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../ClientAuthGate.tsx', import.meta.url), 'utf8')

describe('ClientAuthGate layout', () => {
  it('uses the existing app surface and motion language for the login screen', () => {
    expect(source).toContain("from 'motion/react'")
    expect(source).toContain("from '@/components/settings/SettingsCard'")
    expect(source).toContain("from '@/components/icons/CraftAgentsSymbol'")
    expect(source).toContain('<SettingsCard')
    expect(source).toContain('<motion.section')
    expect(source).toContain('useReducedMotion')
    expect(source).toContain('max-w-[760px]')
    expect(source).toContain('bg-foreground-2')
    expect(source).toContain('AuthContextRow')
    expect(source).toContain('AuthModeButton')
    expect(source).not.toContain('md:grid-cols-[minmax(0,0.92fr)_minmax(340px,1fr)]')
    expect(source).not.toContain('max-w-[430px]')
  })

  it('renders password login first and keeps Feishu as the bottom alternative entry', () => {
    const formIndex = source.indexOf('<form className="space-y-3"')
    const feishuIndex = source.indexOf('使用飞书登录')

    expect(formIndex).toBeGreaterThan(-1)
    expect(feishuIndex).toBeGreaterThan(formIndex)
    expect(source).toContain('或使用飞书')
    expect(source).toContain("variant={emailPasswordEnabled ? 'outline' : 'default'}")
    expect(source).not.toContain('其他登录方式')
  })

  it('lets email-password users switch between sign-in and registration without introducing a second primary surface', () => {
    expect(source).toContain('authMode')
    expect(source).toContain('setAuthMode')
    expect(source).toContain('signUpClient')
    expect(source).toContain('创建账号')
    expect(source).toContain('已有账号')
    expect(source).toContain('registrationNotice')
  })
})
