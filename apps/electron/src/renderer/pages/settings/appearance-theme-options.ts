// input: Preset theme metadata and localized default labels
// output: Stable option arrays for appearance theme dropdowns
// pos: Pure derivation layer for AppearanceSettingsPage theme selectors

import type { SettingsMenuSelectOption } from '@/components/settings'
import type { PresetTheme } from '@config/theme'

export function createPresetThemeOptions(presetThemes: PresetTheme[]): SettingsMenuSelectOption[] {
  return presetThemes
    .filter(theme => theme.id !== 'default')
    .map(theme => ({
      value: theme.id,
      label: theme.theme.name || theme.id,
    }))
}

export function createThemeOptions(
  defaultLabel: string,
  presetThemeOptions: SettingsMenuSelectOption[],
): SettingsMenuSelectOption[] {
  return [
    { value: 'default', label: defaultLabel },
    ...presetThemeOptions,
  ]
}
