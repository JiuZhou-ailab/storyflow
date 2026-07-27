// input: Session question requests and simulated UI responses
// output: Regression coverage for blocking question tool behavior
// pos: Minimal contract check for the human-in-the-loop handler

import { describe, expect, it } from 'bun:test';
import { handleAskUserQuestion } from './ask-user-question.ts';
import type { SessionToolContext } from '../context.ts';

describe('handleAskUserQuestion', () => {
  it('waits for and returns the user answer', async () => {
    const ctx = {
      sessionId: 'session-1',
      callbacks: {
        onPlanSubmitted: () => {},
        onAuthRequest: () => {},
        onAskUserQuestion: async () => ({ answers: { 'Choose one?': 'First' } }),
      },
    } as unknown as SessionToolContext;

    const result = await handleAskUserQuestion(ctx, {
      questions: [{
        header: 'Choice',
        question: 'Choose one?',
        multiSelect: false,
        options: [
          { label: 'First', description: 'Use the first option' },
          { label: 'Second', description: 'Use the second option' },
        ],
      }],
    });

    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain('"Choose one?":"First"');
  });
});
