// input: Preset theme metadata used by appearance settings
// output: Regression coverage for stable theme dropdown option derivation
// pos: Keeps appearance settings option lists shared and semantically correct

import { describe, expect, it } from 'bun:test'
import type { PresetTheme } from '@config/theme'
import {
  createPresetThemeOptions,
  createThemeOptions,
} from '../appearance-theme-options'

function presetTheme(id: string, name?: string): PresetTheme {
  return {
    id,
    path: `/themes/${id}.json`,
    theme: { name } as PresetTheme['theme'],
  }
}

describe('appearance theme options', () => {
  it('filters the built-in default preset and falls back to ids for unnamed themes', () => {
    expect(createPresetThemeOptions([
      presetTheme('default', 'Default'),
      presetTheme('catppuccin', 'Catppuccin'),
      presetTheme('custom-plain'),
    ])).toEqual([
      { value: 'catppuccin', label: 'Catppuccin' },
      { value: 'custom-plain', label: 'custom-plain' },
    ])
  })

  it('prepends the requested default label without rebuilding preset options per workspace', () => {
    const presetOptions = createPresetThemeOptions([presetTheme('nocturne', 'Nocturne')])

    expect(createThemeOptions('Use Default (Nocturne)', presetOptions)).toEqual([
      { value: 'default', label: 'Use Default (Nocturne)' },
      { value: 'nocturne', label: 'Nocturne' },
    ])
  })
})
