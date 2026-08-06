// input: AppShell, navigation authority, settings registry, and settings surfaces
// output: Static regression coverage for project chrome and utility overlays
// pos: Guards against duplicate tools and settings replacing workspace panels

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const appShellSource = readFileSync(new URL('../AppShell.tsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8')
const mainContentPanelSource = readFileSync(new URL('../MainContentPanel.tsx', import.meta.url), 'utf8')
const navigationContextSource = readFileSync(new URL('../../../contexts/NavigationContext.tsx', import.meta.url), 'utf8')
const settingsNavigatorSource = readFileSync(new URL('../../../pages/settings/SettingsNavigator.tsx', import.meta.url), 'utf8')
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
    expect(settingsRegistrySource).toContain("{ id: 'automations' as const")
    expect(settingsPagesSource).toContain('automations: AutomationsSettingsPage')
    expect(settingsIconsSource).toContain('automations: AutomationSettingsIcon')
    expect(zhHansSource).toContain('"settings.automations.title": "自动化"')
  })

  it('keeps settings in an overlay instead of the workspace panel stack', () => {
    expect(navigationContextSource).toContain('settingsSubpage: SettingsSubpage | null')
    expect(navigationContextSource).toContain('setSettingsOverlay(newNavState.subpage)')
    expect(navigationContextSource).toContain("url.searchParams.set('settings', settingsSubpageRef.current)")
    expect(appShellSource).toContain('<SettingsDialog')
    expect(settingsNavigatorSource).toContain('export function SettingsDialog')
    expect(mainContentPanelSource).not.toContain('getSettingsPageComponent')
    expect(appSource).toContain('handleOpenGlobalSettings')
    expect(appSource).toContain("setGlobalSettingsSubpage('app')")
    expect(appSource).toContain('availableSubpages={GLOBAL_SETTINGS_SUBPAGES}')
  })
})
