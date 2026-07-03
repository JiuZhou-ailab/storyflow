// input: Free-form chat input state combinations and IME composition metadata
// output: Regression coverage for input transform and primary action decisions
// pos: Guards chat composer behavior without importing heavyweight UI dependencies

import { describe, expect, it } from 'bun:test'
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
