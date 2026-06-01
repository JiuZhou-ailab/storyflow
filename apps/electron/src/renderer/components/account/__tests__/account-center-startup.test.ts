// input: Renderer App and ActivityRail source
// output: Static regression checks for account center routing
// pos: Ensures the rail account destination opens account management instead of the old profile handoff page

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const appSource = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8')
const activityRailSource = readFileSync(new URL('../../app-shell/ActivityRail.tsx', import.meta.url), 'utf8')

describe('account center routing', () => {
  it('routes avatar/profile actions to the account center', () => {
    expect(appSource).toContain("'account'")
    expect(appSource).toContain('AccountCenterPage')
    expect(appSource).toContain("setAppState('account')")
    expect(appSource).toContain('activeItem="account"')
    expect(activityRailSource).toContain('onOpenAccount')
    expect(activityRailSource).toContain('账户与积分')
  })

  it('keeps account center out of ordinary startup routing', () => {
    expect(appSource).not.toContain('showProfile:')
    expect(appSource).not.toContain("setAppState('profile')")
  })
})
