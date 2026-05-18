// input: Bundled config-defaults.json shape
// output: TypeScript interfaces for distribution-provided defaults
// pos: Schema contract between packaged Electron resources and shared config loading
/**
 * TypeScript types for config-defaults.json
 *
 * Source of truth: apps/electron/resources/config-defaults.json
 * This file only defines types - the actual defaults come from the bundled JSON.
 */

import type { PermissionMode } from '../agent/mode-manager.ts';
import type { ThinkingLevel } from '../agent/thinking-levels.ts';
import type { LlmConnection } from './llm-connections.ts';

export interface BuiltinLlmConnectionDefaults {
  enabled: boolean;
  connection?: LlmConnection;
  apiKey?: string;
  revokedApiKeySha256?: string[];
}

export interface ConfigDefaults {
  version: string;
  description: string;
  defaults: {
    notificationsEnabled: boolean;
    colorTheme: string;
    autoCapitalisation: boolean;
    sendMessageKey: 'enter' | 'cmd-enter';
    spellCheck: boolean;
    keepAwakeWhileRunning: boolean;
    richToolDescriptions: boolean;
    extendedPromptCache: boolean;
    browserToolEnabled: boolean;
  };
  workspaceDefaults: {
    thinkingLevel: ThinkingLevel;
    permissionMode: PermissionMode;
    cyclablePermissionModes: PermissionMode[];
    localMcpServers: {
      enabled: boolean;
    };
  };
  builtinLlmConnection?: BuiltinLlmConnectionDefaults;
}
