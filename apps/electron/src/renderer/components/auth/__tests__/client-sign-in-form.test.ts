// input: Managed-account sign-in form source
// output: Static regression coverage for the compact login screen hierarchy
// pos: Keeps auth surfaces aligned with Storyflow components and action priority

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../ClientSignInForm.tsx', import.meta.url), 'utf8')

describe('ClientSignInForm layout', () => {
  it('uses the existing app surface and motion language for the login screen', () => {
    expect(source).toContain("from 'motion/react'")
    expect(source).toContain("from '@/components/settings/SettingsCard'")
    expect(source).toContain("from '@/components/icons/CraftAgentsSymbol'")
    expect(source).toContain("from '@/components/ui/tabs'")
    expect(source).toContain('<SettingsCard')
    expect(source).toContain('<motion.section')
    expect(source).toContain('useReducedMotion')
    expect(source).toContain('max-w-[420px]')
    expect(source).toContain('bg-foreground-2')
    expect(source).toContain('<TabsList')
    expect(source).not.toContain('grid-cols-[280px_minmax(0,1fr)]')
    expect(source).not.toContain('AuthContextRow')
    expect(source).not.toContain('AuthModeButton')
  })

  it('renders password login first and keeps Feishu as the bottom alternative entry', () => {
    const formIndex = source.indexOf('<form className="space-y-4"')
    const feishuIndex = source.indexOf('使用飞书登录')

    expect(formIndex).toBeGreaterThan(-1)
    expect(feishuIndex).toBeGreaterThan(formIndex)
    expect(source).toContain('或使用飞书')
    expect(source).toContain("variant={emailPasswordEnabled ? 'outline' : 'default'}")
    expect(source).not.toContain('bg-background text-foreground')
    expect(source).not.toContain('其他登录方式')
  })

  it('lets email-password users switch between sign-in and registration without introducing a second primary surface', () => {
    expect(source).toContain('authMode')
    expect(source).toContain('setAuthMode')
    expect(source).toContain('signUpClient')
    expect(source).toContain('emailSignUpEnabled')
    expect(source).toContain('注册后可使用 Storyflow 托管模型，本地项目不受影响。')
    expect(source).toContain('创建账号')
    expect(source).toContain('已有账号')
    expect(source).toContain('registrationNotice')
    expect(source).toContain('工作区仍保存在本机')
  })

  it('uses Neon native email verification without collecting a second invitation secret', () => {
    expect(source).toContain('verifyClientEmail')
    expect(source).toContain('client-auth-otp')
    expect(source).toContain('one-time-code')
    expect(source).not.toContain('invitationCode')
  })

  it('normalizes provider auth errors into product-facing messages', () => {
    expect(source).toContain('formatClientAuthErrorMessage')
    expect(source).toContain('账号或密码不正确')
    expect(source).not.toContain('Invitation required')
    expect(source).not.toContain('Invitation is invalid')
    expect(source).not.toContain('setError(getErrorMessage(err))')
  })
})
