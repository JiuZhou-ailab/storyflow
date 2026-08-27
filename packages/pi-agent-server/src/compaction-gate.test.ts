// input: A Pi session whose native compaction never settles
// output: Regression coverage that timeout cannot race a new prompt against that session
// pos: Guards the Pi auto-compaction serialization boundary

import { expect, it } from 'bun:test'
import { waitForCompaction } from './index.ts'

it('fails closed when Pi compaction does not settle', async () => {
  const calls: string[] = []
  const session = {
    isCompacting: true,
    abortCompaction: () => calls.push('compaction'),
    abortBranchSummary: () => calls.push('branch-summary'),
    dispose: () => calls.push('dispose'),
  }

  await expect(waitForCompaction(session, 1))
    .rejects.toThrow('Compaction wait timed out')
  expect(calls).toEqual(['compaction', 'branch-summary', 'dispose'])
})
