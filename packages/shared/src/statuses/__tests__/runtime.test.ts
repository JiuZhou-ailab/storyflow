import { describe, expect, it } from 'bun:test';
import {
  deriveSessionRuntimeStatus,
  requiresHumanAttention,
  type SessionRuntimeSignals,
} from '../runtime.ts';

describe('deriveSessionRuntimeStatus', () => {
  it('reports idle when nothing is in flight or outstanding', () => {
    expect(deriveSessionRuntimeStatus({})).toBe('idle');
    expect(deriveSessionRuntimeStatus({ isProcessing: false })).toBe('idle');
    expect(deriveSessionRuntimeStatus({ lastMessageRole: 'assistant' })).toBe('idle');
    expect(deriveSessionRuntimeStatus({ lastMessageRole: 'user' })).toBe('idle');
    expect(deriveSessionRuntimeStatus({ lastMessageRole: 'tool' })).toBe('idle');
  });

  it('reports running while a turn is in flight', () => {
    expect(deriveSessionRuntimeStatus({ isProcessing: true })).toBe('running');
  });

  it('reports error when the last turn failed and nothing is in flight', () => {
    expect(deriveSessionRuntimeStatus({ lastMessageRole: 'error' })).toBe('error');
  });

  it('reports waiting-input for an outstanding permission or credential prompt', () => {
    expect(deriveSessionRuntimeStatus({ hasPendingPrompt: true })).toBe('waiting-input');
  });

  it('reports waiting-input for a plan awaiting approval', () => {
    expect(deriveSessionRuntimeStatus({ lastMessageRole: 'plan' })).toBe('waiting-input');
  });

  describe('priority', () => {
    it('ranks a blocked prompt above an in-flight turn', () => {
      // isProcessing stays true while a mid-turn prompt is outstanding; treating
      // this as healthy progress is exactly how a blocked session stalls unnoticed.
      const signals: SessionRuntimeSignals = { isProcessing: true, hasPendingPrompt: true };
      expect(deriveSessionRuntimeStatus(signals)).toBe('waiting-input');
    });

    it('ranks a plan awaiting approval above an in-flight turn', () => {
      const signals: SessionRuntimeSignals = { isProcessing: true, lastMessageRole: 'plan' };
      expect(deriveSessionRuntimeStatus(signals)).toBe('waiting-input');
    });

    it('ranks an in-flight turn above a previous error', () => {
      // A new turn makes the earlier error historical.
      const signals: SessionRuntimeSignals = { isProcessing: true, lastMessageRole: 'error' };
      expect(deriveSessionRuntimeStatus(signals)).toBe('running');
    });

    it('ranks a blocked prompt above a previous error', () => {
      const signals: SessionRuntimeSignals = { hasPendingPrompt: true, lastMessageRole: 'error' };
      expect(deriveSessionRuntimeStatus(signals)).toBe('waiting-input');
    });

    it('surfaces the error once the turn is no longer in flight', () => {
      const signals: SessionRuntimeSignals = { isProcessing: false, lastMessageRole: 'error' };
      expect(deriveSessionRuntimeStatus(signals)).toBe('error');
    });
  });

  it('ignores unread state, which is a read-tracking concern rather than a runtime fact', () => {
    // Unread is about whether the human has looked, not about what the agent is doing.
    expect(deriveSessionRuntimeStatus({ lastMessageRole: 'assistant' })).toBe('idle');
  });
});

describe('requiresHumanAttention', () => {
  it('flags blocked and failed sessions', () => {
    expect(requiresHumanAttention('waiting-input')).toBe(true);
    expect(requiresHumanAttention('error')).toBe(true);
  });

  it('does not flag sessions that are progressing or settled', () => {
    expect(requiresHumanAttention('running')).toBe(false);
    expect(requiresHumanAttention('idle')).toBe(false);
  });
});
