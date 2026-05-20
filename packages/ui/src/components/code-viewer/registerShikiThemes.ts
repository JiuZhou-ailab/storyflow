// input: @pierre/diffs theme registry and bundled Shiki themes
// output: Craft diff themes with transparent backgrounds and readable semantic colors
// pos: Shared bridge between app theming and @pierre/diffs rendering

import { registerCustomTheme, resolveTheme } from '@pierre/diffs'

const GLOBAL_THEME_KEY = '__craftShikiThemesRegistered__'
const LIGHT_DIFF_COLORS = {
  addition: '#1a7f37',
  deletion: '#cf222e',
  modified: '#0969da',
} as const

/**
 * Register craft-dark / craft-light Shiki themes once per runtime.
 * Prevents duplicate registration warnings during HMR or StrictMode re-mounts.
 */
export function registerCraftShikiThemes() {
  if (typeof globalThis === 'undefined') return
  const globalRef = globalThis as typeof globalThis & { [GLOBAL_THEME_KEY]?: boolean }
  if (globalRef[GLOBAL_THEME_KEY]) return
  globalRef[GLOBAL_THEME_KEY] = true

  registerCustomTheme('craft-dark', async () => {
    const theme = await resolveTheme('pierre-dark')
    return { ...theme, name: 'craft-dark', bg: 'transparent', colors: { ...theme.colors, 'editor.background': 'transparent' } }
  })

  registerCustomTheme('craft-light', async () => {
    const theme = await resolveTheme('github-light')
    return {
      ...theme,
      name: 'craft-light',
      bg: 'transparent',
      colors: {
        ...theme.colors,
        'editor.background': 'transparent',
        'terminal.ansiGreen': LIGHT_DIFF_COLORS.addition,
        'terminal.ansiRed': LIGHT_DIFF_COLORS.deletion,
        'terminal.ansiBlue': LIGHT_DIFF_COLORS.modified,
        'gitDecoration.addedResourceForeground': LIGHT_DIFF_COLORS.addition,
        'gitDecoration.deletedResourceForeground': LIGHT_DIFF_COLORS.deletion,
        'gitDecoration.modifiedResourceForeground': LIGHT_DIFF_COLORS.modified,
        'gitDecoration.untrackedResourceForeground': LIGHT_DIFF_COLORS.addition,
      },
    }
  })
}
