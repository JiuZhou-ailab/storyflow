// input: release platform and architecture identifiers
// output: regression coverage for branded desktop artifact filenames
// pos: protects release packaging names during project rebranding

import { describe, expect, test } from 'bun:test';
import { getArtifactName } from './common';

describe('release artifact branding', () => {
  test('uses Storyflow artifact names for packaged desktop apps', () => {
    expect(getArtifactName('darwin', 'arm64')).toBe('Storyflow-arm64.dmg');
    expect(getArtifactName('win32', 'x64')).toBe('Storyflow-x64.exe');
    expect(getArtifactName('linux', 'x64')).toBe('Storyflow-x64.AppImage');
  });
});
