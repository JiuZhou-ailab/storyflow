// input: Optional PI_CODING_AGENT_DIR override and the current user's home directory
// output: Canonical Pi user-level agent directory
// pos: Shared path authority for Pi-native user configuration

import { homedir } from 'node:os';
import { join } from 'node:path';

export function getPiAgentDir(
  configuredAgentDir = process.env.PI_CODING_AGENT_DIR,
): string {
  if (!configuredAgentDir) return join(homedir(), '.pi', 'agent');
  if (configuredAgentDir === '~') return homedir();
  if (configuredAgentDir.startsWith('~/') || (process.platform === 'win32' && configuredAgentDir.startsWith('~\\'))) {
    return join(homedir(), configuredAgentDir.slice(2));
  }
  return configuredAgentDir;
}
