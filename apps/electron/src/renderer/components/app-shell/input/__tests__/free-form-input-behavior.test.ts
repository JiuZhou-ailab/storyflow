// input: Free-form chat input state combinations and IME composition metadata
// output: Regression coverage for input transform and primary action decisions
// pos: Guards chat composer behavior without importing heavyweight UI dependencies

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { THINKING_LEVELS } from '@craft-agent/shared/agent/thinking-levels'
import {
  getPrimaryInputAction,
  isCompositionInput,
  readAttachmentBatch,
  resolveAutoCapitalisedInput,
  shouldShowTextInput,
} from '../free-form-input-behavior'

describe('FreeFormInput behavior helpers', () => {
  describe('isCompositionInput', () => {
    it('treats browser composition input types as composition input', () => {
      expect(isCompositionInput({ inputType: 'insertCompositionText' })).toBe(true)
      expect(isCompositionInput({ inputType: 'insertFromComposition' })).toBe(true)
    })
  })

  describe('resolveAutoCapitalisedInput', () => {
  it('does not rewrite IME composition text', () => {
      expect(resolveAutoCapitalisedInput('n', 1, {
        enabled: true,
        isCompositionInput: true,
      })).toBeNull()
    })

    it('treats post-composition input as composition input', () => {
      expect(isCompositionInput({ isPostCompositionInput: true })).toBe(true)
    })

    it('capitalises ordinary latin input when enabled', () => {
      expect(resolveAutoCapitalisedInput('hello', 1, {
        enabled: true,
        isCompositionInput: false,
      })).toEqual({ text: 'Hello', cursor: 1 })
    })

    it('leaves commands and mentions unchanged', () => {
      expect(resolveAutoCapitalisedInput('/compact', 1, {
        enabled: true,
        isCompositionInput: false,
      })).toBeNull()
      expect(resolveAutoCapitalisedInput('@skill', 1, {
        enabled: true,
        isCompositionInput: false,
      })).toBeNull()
      expect(resolveAutoCapitalisedInput('#label', 1, {
        enabled: true,
        isCompositionInput: false,
      })).toBeNull()
    })
  })

  describe('getPrimaryInputAction', () => {
    it('uses send while processing when there is draft content to queue', () => {
      expect(getPrimaryInputAction({
        isProcessing: true,
        hasContent: true,
        disabled: false,
        disableSend: false,
      })).toBe('send')
    })

    it('uses stop while processing with an empty draft', () => {
      expect(getPrimaryInputAction({
        isProcessing: true,
        hasContent: false,
        disabled: false,
        disableSend: false,
      })).toBe('stop')
    })

    it('keeps send as the primary action for a draft while processing even when sending is disabled', () => {
      expect(getPrimaryInputAction({
        isProcessing: true,
        hasContent: true,
        disabled: true,
        disableSend: true,
      })).toBe('send')
    })
  })

  describe('shouldShowTextInput', () => {
    it('keeps compact input visible while the agent is processing', () => {
      expect(shouldShowTextInput({
        compactMode: true,
        isProcessing: true,
      })).toBe(true)
    })
  })

  describe('readAttachmentBatch', () => {
    it('limits concurrent file reads and keeps successful attachments ordered', async () => {
      let started = 0
      let releaseFirst: () => void = () => {
        throw new Error('first read was not started')
      }
      let releaseSecond: () => void = () => {
        throw new Error('second read was not started')
      }

      const resultPromise = readAttachmentBatch(['first', 'second', 'third'], async (file, index) => {
        started++
        if (file === 'first') {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve
          })
        }
        if (file === 'second') {
          await new Promise<void>((resolve) => {
            releaseSecond = resolve
          })
          return null
        }
        return {
          type: 'text',
          path: file,
          name: `${index}:${file}`,
          mimeType: 'text/plain',
          size: 1,
        }
      }, 2)

      await Promise.resolve()
      expect(started).toBe(2)

      releaseFirst()
      await Promise.resolve()
      await Promise.resolve()
      expect(started).toBe(3)

      releaseSecond()
      await expect(resultPromise).resolves.toEqual([
        {
          type: 'text',
          path: 'first',
          name: '0:first',
          mimeType: 'text/plain',
          size: 1,
        },
        {
          type: 'text',
          path: 'third',
          name: '2:third',
          mimeType: 'text/plain',
          size: 1,
        },
      ])
    })
  })
})

describe('FreeFormInput attachment read path', () => {
  it('uses main-side user attachment reads before renderer FileReader for path-backed files', () => {
    const source = readFileSync(new URL('../FreeFormInput.tsx', import.meta.url), 'utf-8')
    const helperStart = source.indexOf('const readFileAsAttachment = async')
    const helperEnd = source.indexOf('const processFileAttachments = async', helperStart)
    const helperSource = source.slice(helperStart, helperEnd)

    expect(helperSource).toContain('window.electronAPI.readUserAttachment(realPath)')
    expect(helperSource.indexOf('window.electronAPI.readUserAttachment(realPath)')).toBeLessThan(
      helperSource.indexOf('new FileReader()'),
    )
  })
})

describe('FreeFormInput model menu', () => {
  it('shows thinking levels only as a capability-gated model submenu', () => {
    const source = readFileSync(new URL('../FreeFormInput.tsx', import.meta.url), 'utf-8')

    expect(source).toContain('modelSupportsThinking(connection, modelId)')
    expect(source).toContain('<StyledDropdownMenuSubTrigger')
    expect(source).toContain("THINKING_LEVELS.filter(({ id }) => id !== 'off')")
    expect(source).toContain('className="w-[220px] whitespace-normal"')
    expect(THINKING_LEVELS.find(({ id }) => id === 'xhigh')?.descriptionKey)
      .toBe('thinking.extendedDesc')
    expect(source).not.toContain('thinkingDisabled')
    expect(source).not.toContain('getThinkingLevelNameKey')
  })
})

describe('FreeFormInput render hot paths', () => {
  it('memoizes source and skill lookups used while typing', () => {
    const source = readFileSync(new URL('../FreeFormInput.tsx', import.meta.url), 'utf-8')

    expect(source).toContain('const skillSlugs = React.useMemo')
    expect(source).toContain('const sourceSlugs = React.useMemo')
    expect(source).toContain('const selectedSourcesForBadge = React.useMemo')
    expect(source).not.toContain('const skillSlugs = skills.map')
    expect(source).not.toContain('const sourceSlugs = sources.map')
    expect(source.match(/sources\.filter\(s => optimisticSourceSlugs\.includes\(s\.config\.slug\)\)/g) ?? []).toHaveLength(0)
  })

  it('skips source mention parsing for ordinary input changes without source tokens', () => {
    const source = readFileSync(new URL('../FreeFormInput.tsx', import.meta.url), 'utf-8')
    const handlerStart = source.indexOf('const handleInputChange = React.useCallback')
    const handlerEnd = source.indexOf('const handleRichInput = React.useCallback', handlerStart)
    const handlerSource = source.slice(handlerStart, handlerEnd)

    expect(handlerSource).toContain("const mayHaveSourceMentions = prevValue.includes('[source:') || nextValue.includes('[source:')")
    expect(handlerSource).toContain('if (onSourcesChange && mayHaveSourceMentions)')
    expect(handlerSource).toContain('const currentSourceSet = new Set(currMentions.sources)')
    expect(handlerSource).not.toContain('!currMentions.sources.includes(slug)')
  })

  it('skips inline menu detectors for ordinary rich text input without triggers', () => {
    const source = readFileSync(new URL('../FreeFormInput.tsx', import.meta.url), 'utf-8')
    const handlerStart = source.indexOf('const handleRichInput = React.useCallback')
    const handlerEnd = source.indexOf('// Handle inline slash command selection', handlerStart)
    const handlerSource = source.slice(handlerStart, handlerEnd)

    expect(handlerSource).toContain('const textBeforeCursor = nextValue.slice(0, cursorPosition)')
    expect(handlerSource).toContain("if (inlineSlash.isOpen || textBeforeCursor.includes('/'))")
    expect(handlerSource).toContain("if (inlineMention.isOpen || textBeforeCursor.includes('@'))")
    expect(handlerSource).toContain("if (inlineLabel.isOpen || textBeforeCursor.includes('#'))")
    expect(handlerSource).not.toContain('// Update inline slash command state\n    inlineSlash.handleInputChange(nextValue, cursorPosition)')
  })
})
