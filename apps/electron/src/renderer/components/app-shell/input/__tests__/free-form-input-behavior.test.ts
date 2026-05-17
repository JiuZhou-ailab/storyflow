// input: Free-form chat input state combinations and IME composition metadata
// output: Regression coverage for input transform and primary action decisions
// pos: Guards chat composer behavior without importing heavyweight UI dependencies

import { describe, expect, it } from 'bun:test'
import {
  getPrimaryInputAction,
  isCompositionInput,
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
  })

  describe('shouldShowTextInput', () => {
    it('keeps compact input visible while the agent is processing', () => {
      expect(shouldShowTextInput({
        compactMode: true,
        isProcessing: true,
      })).toBe(true)
    })
  })
})
