// input: Overlay dismissal bridge behavior and responsive viewport widths
// output: Regression checks for escape delegation and desktop modal breakpoint
// pos: Focused contract test for shared overlay dismissal and layout resolution
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { handleFullscreenEscapeWithStack } from '../FullscreenOverlayBase'
import { setDismissibleLayerBridge } from '../../../lib/dismissible-layer-bridge'
import { OVERLAY_LAYOUT, resolveOverlayMode } from '../../../lib/layout'

afterEach(() => {
  setDismissibleLayerBridge(null)
})

describe('handleFullscreenEscapeWithStack', () => {
  it('returns false when no stack bridge is registered', () => {
    expect(handleFullscreenEscapeWithStack()).toBe(false)
  })

  it('delegates escape handling to the shared dismissible layer stack', () => {
    const handleEscape = mock(() => true)

    setDismissibleLayerBridge({
      registerLayer: () => () => {},
      hasOpenLayers: () => true,
      getTopLayer: () => ({ id: 'island-1', type: 'island', priority: 200 }),
      closeTop: () => true,
      handleEscape,
    })

    const handled = handleFullscreenEscapeWithStack()
    expect(handled).toBe(true)
    expect(handleEscape).toHaveBeenCalledTimes(1)
  })
})

describe('resolveOverlayMode', () => {
  it('keeps document overlays fullscreen below the desktop breakpoint', () => {
    expect(resolveOverlayMode(
      OVERLAY_LAYOUT.desktopModalBreakpoint - 1,
      OVERLAY_LAYOUT.desktopModalBreakpoint,
    )).toBe('fullscreen')
  })

  it('uses a modal for document overlays at the desktop breakpoint', () => {
    expect(resolveOverlayMode(
      OVERLAY_LAYOUT.desktopModalBreakpoint,
      OVERLAY_LAYOUT.desktopModalBreakpoint,
    )).toBe('modal')
  })

  it('does not change the fullscreen default for other overlays', () => {
    expect(resolveOverlayMode(1400)).toBe('fullscreen')
  })
})
