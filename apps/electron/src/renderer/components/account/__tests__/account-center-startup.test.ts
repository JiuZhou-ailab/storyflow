// input: Renderer App, ActivityRail, root crash boundary, and packaged Electron smoke source
// output: Static regression checks for settings-owned account data and platform-stable E2E observation
// pos: Ensures the profile menu stays compact while account facts live in App settings

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const appSource = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8')
const activityRailSource = readFileSync(new URL('../../app-shell/ActivityRail.tsx', import.meta.url), 'utf8')
const appSettingsSource = readFileSync(new URL('../../../pages/settings/AppSettingsPage.tsx', import.meta.url), 'utf8')
const rendererMainSource = readFileSync(new URL('../../../main.tsx', import.meta.url), 'utf8')
const coreE2eSource = readFileSync(new URL('../../../../../../../e2e/core/run.ts', import.meta.url), 'utf8')

describe('account settings ownership', () => {
  it('keeps account facts in settings instead of a separate destination', () => {
    expect(appSettingsSource).toContain('<AccountSettingsSection />')
    expect(appSettingsSource).toContain('<LocalUsageSection />')
    expect(appSource).not.toContain('AccountCenterPage')
    expect(appSource).not.toContain('accountCenterOpen')
    expect(appSource).not.toContain("setAppState('account')")
    expect(appSource).not.toContain('activeItem="account"')
    expect(appSource).toContain('profile={activityRailProfile}')
    expect(activityRailSource).not.toContain('onOpenAccount')
    expect(activityRailSource).toContain('onSignOut')
    expect(activityRailSource).toContain('data-tutorial="activity-profile"')
    expect(activityRailSource).toContain('data-tutorial="activity-settings"')
    expect(coreE2eSource).toContain('[data-tutorial="activity-settings"]')
    expect(activityRailSource).toContain('退出登录')
  })

  it('keeps account management out of startup and workspace routing', () => {
    expect(appSource).not.toContain('showProfile:')
    expect(appSource).not.toContain("setAppState('profile')")
    expect(appSource).not.toContain("appState === 'account'")
  })

  it('observes packaged account navigation without locale or pointer timing assumptions', () => {
    expect(rendererMainSource).toContain('data-testid="root-crash-fallback"')
    expect(coreE2eSource).toContain('[data-testid="root-crash-fallback"]')
    expect(coreE2eSource).not.toContain("includes('出错了')")
    expect(coreE2eSource).toContain("type: 'mouseMoved'")
    expect(coreE2eSource).toContain("buttons: 1")
    expect(coreE2eSource).toContain("buttons: 0")
  })
})
