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
    expect(source).not.toContain("from '@/components/ui/tabs'")
    expect(source).toContain('<SettingsCard')
    expect(source).toContain('<motion.section')
    expect(source).toContain('useReducedMotion')
    expect(source).toContain('max-w-[420px]')
    expect(source).toContain('bg-foreground-2')
    expect(source).toContain('text-center')
    expect(source).toContain('mx-auto flex size-11')
    expect(source).not.toContain('<TabsList')
    expect(source).not.toContain('aria-label="邮箱账号状态"')
    expect(source).not.toContain('grid-cols-[280px_minmax(0,1fr)]')
    expect(source).not.toContain('AuthContextRow')
    expect(source).not.toContain('AuthModeButton')
  })

  it('renders the email form first and keeps Feishu as the bottom alternative', () => {
    const formIndex = source.indexOf('id="client-auth-credentials-form"')
    const feishuIndex = source.indexOf('使用飞书登录')

    expect(formIndex).toBeGreaterThan(-1)
    expect(feishuIndex).toBeGreaterThan(-1)
    expect(feishuIndex).toBeGreaterThan(formIndex)
    expect(source).toContain('或')
    expect(source).not.toContain('外部受邀成员')
    expect(source).toContain("variant={emailPasswordEnabled ? 'outline' : 'default'}")
    expect(source).not.toContain('bg-background text-foreground')
  })

  it('lets email users switch between sign-in and first-time registration', () => {
    expect(source).toContain('authMode')
    expect(source).toContain('setAuthMode')
    expect(source).toContain('signUpClient')
    expect(source).toContain('emailSignUpEnabled')
    expect(source).toContain('创建账号')
    expect(source).toContain('直接登录')
    expect(source).toContain("emailSignUpEnabled ? 'grid grid-cols-2 gap-2' : undefined")
    expect(source).not.toContain('还没有账号？')
    expect(source).not.toContain('已有账号？')
    expect(source).toContain('registrationNotice')
    expect(source).toContain('工作区仍保存在本机')
  })

  it('renders email verification as a dedicated recoverable step', () => {
    expect(source).toContain('verifyClientEmail')
    expect(source).toContain('resendClientVerificationEmail')
    expect(source).toContain('handleVerificationSubmit')
    expect(source).toContain('handleResendVerificationEmail')
    expect(source).toContain('client-auth-otp')
    expect(source).toContain('one-time-code')
    expect(source).toContain('修改邮箱')
    expect(source).toContain('重新发送验证码')
    expect(source).toContain('新的验证码已发送，请检查收件箱和垃圾邮件')
    expect(source).toContain('邮箱验证已完成，可直接登录')
    expect(source).toContain('setVerificationEmail(null)')
    expect(source).not.toContain('invitationCode')
  })

  it('normalizes provider auth errors into product-facing messages', () => {
    expect(source).toContain('formatClientAuthErrorMessage')
    expect(source).toContain('账号或密码不正确')
    expect(source).not.toContain('Invitation required')
    expect(source).not.toContain('Invitation is invalid')
    expect(source).not.toContain('setError(getErrorMessage(err))')
    expect(source).toContain('role="alert"')
    expect(source).toContain('role="status"')
  })
})
