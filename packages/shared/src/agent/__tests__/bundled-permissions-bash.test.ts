import { describe, expect, it } from 'bun:test';
import bundled from '../../../../../apps/electron/resources/permissions/default.json';
import { getBashRejectionReason } from '../mode-manager.ts';
import { SAFE_MODE_CONFIG } from '../mode-types.ts';

const config = {
  ...SAFE_MODE_CONFIG,
  readOnlyBashPatterns: bundled.allowedBashPatterns.map(({ pattern, comment }) => ({
    regex: new RegExp(pattern),
    source: pattern,
    comment,
  })),
};

describe('bundled Bash help permissions', () => {
  it.each([
    'bash -c x --help',
    'sh -c x -h',
    'python3 -c x -h',
    'rm -rf x --help',
  ])('rejects %s', (command) => {
    expect(getBashRejectionReason(command, config)).not.toBeNull();
  });

  it.each(['ls --help', 'git --help', 'craft-agent label --help'])(
    'allows %s',
    (command) => {
      expect(getBashRejectionReason(command, config)).toBeNull();
    },
  );
});
