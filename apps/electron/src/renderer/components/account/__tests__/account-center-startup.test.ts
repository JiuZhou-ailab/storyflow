// input: Renderer App, ActivityRail, root crash boundary, and packaged Electron smoke source
// output: Static regression checks for account routing and platform-stable E2E observation
// pos: Ensures the rail account destination opens account management instead of the old profile handoff page

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const appSource = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8')
const activityRailSource = readFileSync(new URL('../../app-shell/ActivityRail.tsx', import.meta.url), 'utf8')
const rendererMainSource = readFileSync(new URL('../../../main.tsx', import.meta.url), 'utf8')
const coreE2eSource = readFileSync(new URL('../../../../../../../e2e/core/run.ts', import.meta.url), 'utf8')

describe('account center routing', () => {
  it('routes avatar/profile actions to the account center', () => {
    expect(appSource).toContain("'account'")
    expect(appSource).toContain('AccountCenterPage')
    expect(appSource).toContain("setAppState('account')")
    expect(appSource).toContain('activeItem="account"')
    expect(appSource).toContain('profile={activityRailProfile}')
    expect(activityRailSource).toContain('onOpenAccount')
    expect(activityRailSource).toContain('data-tutorial="activity-profile"')
    expect(activityRailSource).toContain('账户')
    expect(activityRailSource).not.toContain('账户与积分')
  })

  it('keeps account center out of ordinary startup routing', () => {
    expect(appSource).not.toContain('showProfile:')
    expect(appSource).not.toContain("setAppState('profile')")
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
