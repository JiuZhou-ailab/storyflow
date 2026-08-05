// input: Product session spawn options and mini-agent constraints
// output: Pi Product Host request/result contracts and fixed mini-agent policy
// pos: Small product-owned contracts shared by PiAgent, SessionManager, and tests

import type { PermissionMode } from './mode-manager.ts';
import type { ThinkingLevel } from './thinking-levels.ts';

export interface MiniAgentConfig {
  enabled: boolean;
  tools: readonly string[];
  mcpServerKeys: readonly string[];
  minimizeThinking: boolean;
}

export interface SpawnSessionRequest {
  prompt: string;
  name?: string;
  llmConnection?: string;
  model?: string;
  enabledSourceSlugs?: string[];
  permissionMode?: PermissionMode;
  thinkingLevel?: ThinkingLevel;
  labels?: string[];
  workingDirectory?: string;
  attachments?: Array<{ path: string; name?: string }>;
}

export interface SpawnSessionResult {
  sessionId: string;
  name: string;
  status: 'started';
  connection?: string;
  model?: string;
}

export interface SpawnSessionHelpResult {
  connections: Array<{
    slug: string;
    name: string;
    isDefault: boolean;
    providerType: string;
    models: string[];
    defaultModel?: string;
  }>;
  sources: Array<{
    slug: string;
    name: string;
    type: string;
    enabled: boolean;
  }>;
  defaults: {
    defaultConnection: string | null;
    permissionMode: string;
  };
}

export const MINI_AGENT_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'] as const;
export const MINI_AGENT_MCP_KEYS = ['session'] as const;
