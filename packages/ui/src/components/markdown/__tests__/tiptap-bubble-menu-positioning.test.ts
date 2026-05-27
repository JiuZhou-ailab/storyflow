// input: TipTap editor shell and scroll container elements
// output: Regression coverage for BubbleMenu floating-ui runtime options
// pos: Guards selection bubble menus against drifting with scrollable editor content

import { describe, expect, it } from 'bun:test'
import {
  buildTextSelectionBubbleMenuOptions,
  shouldRenderTextSelectionBubbleMenu,
} from '../TiptapBubbleMenus'

describe('buildTextSelectionBubbleMenuOptions', () => {
  it('mounts text selection menus outside the scrollable content while listening to content scroll', () => {
    const shell = {} as HTMLElement
    const scrollTarget = {} as HTMLElement

    const options = buildTextSelectionBubbleMenuOptions({
      appendTo: shell,
      scrollTarget,
      placement: 'bottom-start',
      offset: 8,
    })

    expect(options.appendTo).toBe(shell)
    expect(options.options).toMatchObject({
      placement: 'bottom-start',
      offset: 8,
      scrollTarget,
      hide: true,
    })
  })
})

describe('shouldRenderTextSelectionBubbleMenu', () => {
  it('hides text selection menus after editor content scroll dismisses them', () => {
    expect(shouldRenderTextSelectionBubbleMenu({
      dismissedByScroll: true,
      hasTextSelection: true,
      isNodeSelection: false,
      isCodeBlockActive: false,
    })).toBe(false)
  })

  it('keeps text selection menus renderable for an active non-code text selection', () => {
    expect(shouldRenderTextSelectionBubbleMenu({
      dismissedByScroll: false,
      hasTextSelection: true,
      isNodeSelection: false,
      isCodeBlockActive: false,
    })).toBe(true)
  })
})
