// input: AccountSettingsSection source
// output: Static regression coverage for factual account settings
// pos: Keeps account management inside settings and outside app routing

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../AccountSettingsSection.tsx', import.meta.url), 'utf8')

describe('AccountSettingsSection', () => {
  it('presents factual account information inside App settings', () => {
    expect(source).toContain("t('settings.app.account.title')")
    expect(source).toContain('ClientAuthUser')
    expect(source).toContain('CrossfadeAvatar')
    expect(source).toContain('user.avatarUrl')
    expect(source).toContain("t('settings.app.account.emailUnbound')")
    expect(source).not.toContain('AccountFact')
    expect(source).not.toContain('UserCircle')
    expect(source).not.toContain('积分')
    expect(source).not.toContain('订阅')
    expect(source).not.toContain('待同步')
    expect(source).not.toContain('进入项目中心')
    expect(source).not.toContain('onContinue')
  })

  it('keeps root-owned auth state as the single source of truth', () => {
    expect(source).toContain('useAccountSettings()')
    expect(source).toContain('runtimeWorkspace')
    expect(source).toContain('onClientSignedIn')
    expect(source).toContain('ClientSignInForm')
    expect(source).not.toContain('<Dialog')
    expect(source).not.toContain('onSignOut')
  })
})
