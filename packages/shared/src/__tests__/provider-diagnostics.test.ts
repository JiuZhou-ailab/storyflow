// input: Isolated session directories and synthetic provider errors.
// output: Regression proof that diagnostics never cross session boundaries.
// pos: Focused contract test for the provider diagnostic file bridge.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getLastApiError,
  setStoredError,
} from '../provider-diagnostics.ts';

describe('provider-diagnostics', () => {
  let sessionDirA: string;
  let sessionDirB: string;

  beforeEach(() => {
    sessionDirA = mkdtempSync(join(tmpdir(), 'interceptor-a-'));
    sessionDirB = mkdtempSync(join(tmpdir(), 'interceptor-b-'));
  });

  afterEach(() => {
    rmSync(sessionDirA, { recursive: true, force: true });
    rmSync(sessionDirB, { recursive: true, force: true });
  });

  it('keeps API errors session-scoped', () => {
    setStoredError({
      status: 401,
      statusText: 'Unauthorized',
      message: 'Session A auth failed',
      timestamp: Date.now(),
    }, sessionDirA);

    setStoredError({
      status: 429,
      statusText: 'Too Many Requests',
      message: 'Session B rate limit',
      timestamp: Date.now(),
    }, sessionDirB);

    const errA = getLastApiError(sessionDirA);
    expect(errA?.status).toBe(401);

    const errB = getLastApiError(sessionDirB);
    expect(errB?.status).toBe(429);
  });
});
