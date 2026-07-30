// input: Cacheable prompt text and active Pi tool definitions
// output: Stable SHA-256 fingerprints for prompt-cache diagnostics
// pos: Small observability helper for the Pi prompt boundary

import { createHash } from 'node:crypto';

export function fingerprint(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function fingerprintTools(
  tools: Array<{ name: string; description: string; parameters: unknown }>,
): string {
  const serialized = JSON.stringify(
    [...tools]
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
      .map(({ name, description, parameters }) => ({ name, description, parameters })),
  );
  return fingerprint(serialized);
}
