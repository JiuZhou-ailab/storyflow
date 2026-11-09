// Run each repetition in a fresh process: cache-prefix captures config at import.
// Keep this in the existing isolated-test suite so Validate proves all 20 runs.
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

test('cache-prefix recovery passes 20 consecutive isolated runs', () => {
  for (let iteration = 1; iteration <= 20; iteration++) {
    const result = spawnSync(process.execPath, ['test', './packages/server-core/src/sessions/cache-prefix.isolated.ts'], {
      cwd: new URL('../../../../', import.meta.url),
      encoding: 'utf8',
      timeout: 30_000,
    });
    console.log(`cache-prefix iteration ${iteration}/20: ${result.status === 0 ? 'PASS' : 'FAIL'}`);
    expect(result.error, `iteration ${iteration}: ${result.error}`).toBeUndefined();
    expect(result.status, `iteration ${iteration}\n${result.stdout}\n${result.stderr}`).toBe(0);
  }
}, 120_000);
