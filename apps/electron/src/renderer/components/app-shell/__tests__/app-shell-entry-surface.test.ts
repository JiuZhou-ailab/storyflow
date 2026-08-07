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
const appSettingsSource = readFileSync(new URL('../../../pages/settings/AppSettingsPage.tsx', import.meta.url), 'utf8')
const aiContextSettingsSource = readFileSync(new URL('../../../pages/settings/AiContextSettings.tsx', import.meta.url), 'utf8')
const inputSettingsSource = readFileSync(new URL('../../../pages/settings/InputSettingsPage.tsx', import.meta.url), 'utf8')
const aiSettingsSource = readFileSync(new URL('../../../pages/settings/AiSettingsPage.tsx', import.meta.url), 'utf8')
const onboardingWizardSource = readFileSync(new URL('../../onboarding/OnboardingWizard.tsx', import.meta.url), 'utf8')
const shortcutsSettingsSource = readFileSync(new URL('../../../pages/settings/ShortcutsPage.tsx', import.meta.url), 'utf8')
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

  it('keeps the settings rail compact and reserves the top-right corner for close', () => {
    expect(settingsNavigatorSource).not.toContain('item.description')
    expect(settingsNavigatorSource).not.toContain('<MoreHorizontal')
    expect(settingsNavigatorSource).not.toContain('<AppWindow')
    expect(settingsNavigatorSource).not.toContain('craftagents://settings/${selectedSubpage}?window=focused')
    expect(settingsNavigatorSource).toContain('data-settings-dialog-close')
    expect(settingsNavigatorSource).toContain('onClick={onClose}')
    expect(settingsNavigatorSource).toContain('className="titlebar-no-drag absolute right-2 top-[5px]')
    expect(settingsNavigatorSource).toContain('[&_.titlebar-drag-region]:pr-12')
  })

  it('groups project settings and merges shortcuts into the input surface', () => {
    expect(settingsNavigatorSource).toContain('PRIMARY_SETTINGS_SUBPAGES')
    expect(settingsNavigatorSource).toContain('PROJECT_SETTINGS_SUBPAGES')
    expect(settingsNavigatorSource).toContain("t('settings.navigation.currentProject')")
    expect(settingsNavigatorSource).toContain('aria-expanded={isProjectGroupOpen}')
    expect(settingsNavigatorSource).toContain("item.id === 'input' && selectedSubpage === 'shortcuts'")
    expect(appShellSource).toContain('availableSubpages={isProjectRuntime ? undefined : GLOBAL_SETTINGS_SUBPAGES}')
    expect(inputSettingsSource).toContain('<ShortcutsSettingsContent showTitle />')
    expect(shortcutsSettingsSource).toContain('export function ShortcutsSettingsContent')
    expect(settingsPagesSource).toContain('shortcuts: ShortcutsPage')
  })

  it('consolidates everyday app toggles and merges personalization into AI settings', () => {
    expect(appSettingsSource).toContain('settings.app.general')
    expect(appSettingsSource).toContain('handleNotificationsEnabledChange')
    expect(appSettingsSource).toContain('handleKeepAwakeEnabledChange')
    expect(appSettingsSource).toContain('handleBrowserToolEnabledChange')
    expect(settingsNavigatorSource).not.toContain("  'preferences',")
    expect(settingsNavigatorSource).toContain("item.id === 'ai' && selectedSubpage === 'preferences'")
    expect(settingsPagesSource).toContain('preferences: AiSettingsPage')
    expect(aiSettingsSource).toContain('<AiContextSettings />')
    expect(aiContextSettingsSource).toContain('readSystemInstructions')
    expect(aiContextSettingsSource).toContain('writeSystemInstructions')
    expect(aiContextSettingsSource).toContain('settings.preferences.systemInstructions')
    expect(aiContextSettingsSource).not.toContain('settings.preferences.basicInfo')
    expect(aiContextSettingsSource).not.toContain('readPreferences')
  })

  it('starts with Storyflow managed models and reserves provider setup for settings', () => {
    expect(appSource).not.toContain('getSetupNeeds()')
    expect(appSource).not.toContain("appState === 'onboarding'")
    expect(onboardingWizardSource).not.toContain('ProviderSelectStep')
    expect(aiSettingsSource).toContain("initialStep: 'credentials'")
    expect(aiSettingsSource).toContain("initialApiSetupMethod: 'pi_api_key'")
  })
})
