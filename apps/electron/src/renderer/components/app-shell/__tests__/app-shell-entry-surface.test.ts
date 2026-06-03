// input: AppShell, settings registry, settings page map, and legacy app menu source
// output: Static regression coverage for project chrome entry surfaces
// pos: Guards against duplicate top-bar tools and premature feature exposure

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const appShellSource = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8')
const appMenuSource = readFileSync(new URL('../../AppMenu.tsx', import.meta.url), 'utf8')
const settingsRegistrySource = readFileSync(new URL('../../../../shared/settings-registry.ts', import.meta.url), 'utf8')
const settingsPagesSource = readFileSync(new URL('../../../pages/settings/settings-pages.ts', import.meta.url), 'utf8')
const settingsIconsSource = readFileSync(new URL('../../icons/SettingsIcons.tsx', import.meta.url), 'utf8')
const zhHansSource = readFileSync(new URL('../../../../../../../packages/shared/src/i18n/locales/zh-Hans.json', import.meta.url), 'utf8')

describe('app shell entry surface', () => {
  it('does not duplicate the writing version tool in the top headbar', () => {
    expect(appShellSource).not.toContain('id: "nav:writing-version"')
    expect(appShellSource).not.toContain("result.push({ id: 'nav:writing-version'")
    expect(appShellSource).toContain("tooltip={t('writing.version.title', '版本管理')}")
  })

  it('hides automations from workspace chrome and keeps them under settings', () => {
    expect(appShellSource).not.toContain('id: "nav:automations"')
    expect(appShellSource).not.toContain("result.push({ id: 'nav:automations'")
    expect(appMenuSource).not.toContain('menu.helpAutomations')

    expect(settingsRegistrySource).toContain("{ id: 'automations' as const")
    expect(settingsPagesSource).toContain('automations: AutomationsSettingsPage')
    expect(settingsIconsSource).toContain('automations: AutomationSettingsIcon')
    expect(zhHansSource).toContain('"settings.automations.title": "自动化"')
  })
})
