// input: The Pi agent-core version pinned by pi-agent-server.
// output: Regression proof that Pi executes multi-tool assistant turns in parallel by default.
// pos: Guards removal of Storyflow's former speculative call_llm prefetch workaround.

import { expect, test } from 'bun:test';
import { Agent } from '@earendil-works/pi-agent-core';

test('Pi defaults tool execution mode to parallel', () => {
  expect(new Agent().toolExecution).toBe('parallel');
});
