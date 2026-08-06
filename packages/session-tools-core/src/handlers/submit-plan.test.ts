// input: SubmitPlan arguments and an asynchronous host handoff callback
// output: Regression coverage for completing the handoff before returning tool success
// pos: Guards ordering between plan persistence, runtime interruption, and Pi continuation

import { describe, expect, it } from 'bun:test';
import { handleSubmitPlan } from './submit-plan.ts';

describe('handleSubmitPlan', () => {
  it('waits for the host handoff before returning success', async () => {
    let finishHandoff!: () => void;
    const handoff = new Promise<void>(resolve => { finishHandoff = resolve; });
    let completed = false;

    const resultPromise = handleSubmitPlan({
      callbacks: {
        onPlanSubmitted: () => handoff,
      },
      fs: {
        exists: () => true,
        readFile: () => '# Plan',
      },
    } as never, { planPath: '/tmp/PLAN.md' }).then(result => {
      completed = true;
      return result;
    });

    await Promise.resolve();
    expect(completed).toBe(false);

    finishHandoff();
    const result = await resultPromise;

    expect(completed).toBe(true);
    expect(result.isError).toBe(false);
  });
});
