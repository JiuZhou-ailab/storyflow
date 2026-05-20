// input: Craft Shiki diff theme registration
// output: Regression coverage for light-theme diff color contrast
// pos: Protects readable diff indicators when no app-level Shiki context is available

import { describe, expect, it } from 'bun:test'
import { resolveTheme } from '@pierre/diffs'
import { registerCraftShikiThemes } from '../registerShikiThemes'

const DEFAULT_LIGHT_BACKGROUND = '#faf9fb'
const MIN_TEXT_CONTRAST = 4.5

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Expected a 6-digit hex color, received ${hex}`)
  }
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ]
}

function relativeLuminance(hex: string): number {
  const channels = hexToRgb(hex).map((value) => {
    const channel = value / 255
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  })
  const [red, green, blue] = channels
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground)
  const backgroundLuminance = relativeLuminance(background)
  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

describe('registerCraftShikiThemes', () => {
  it('keeps craft-light diff semantic colors readable on the default light background', async () => {
    registerCraftShikiThemes()

    const theme = await resolveTheme('craft-light')
    const colors = theme.colors ?? {}
    const semanticColors = [
      colors['gitDecoration.addedResourceForeground'],
      colors['gitDecoration.deletedResourceForeground'],
      colors['gitDecoration.modifiedResourceForeground'],
    ]

    for (const color of semanticColors) {
      expect(color).toBeString()
      expect(contrastRatio(color!, DEFAULT_LIGHT_BACKGROUND)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
    }
  })
})
