// input: Persisted session fields plus live Pi, source, queue, auth, and UI runtime state
// output: The server-owned in-memory session aggregate used by SessionManager
// pos: Explicit session state model separated from lifecycle orchestration

import type { PiAgent, AuthRequest, PermissionMode } from '@craft-agent/shared/agent';
import type { ConversationRewindBoundary } from '@craft-agent/shared/agent/backend/types';
import type { Workspace } from '@craft-agent/shared/config';
import type { McpClientPool } from '@craft-agent/shared/mcp';
import type { FileAttachment, SendMessageOptions } from '@craft-agent/shared/protocol';
import type { SessionHeader } from '@craft-agent/shared/sessions';
import type { TokenRefreshManager } from '@craft-agent/shared/sources';
import type { Message, StoredAttachment, TurnMetrics } from '@craft-agent/core/types';
import type { ThinkingLevel } from '@craft-agent/shared/agent/thinking-levels';

export type AgentInstance = PiAgent;

export interface ManagedSession {
  id: string;
  workspace: Workspace;
  agent: AgentInstance | null;
  messages: Message[];
  isProcessing: boolean;
  pendingConversationRewind?: {
    token: string;
    boundary: ConversationRewindBoundary;
    revision: string;
    expiresAt: number;
  };
  rewindCommitInProgress?: boolean;
  stopRequested?: boolean;
  lastMessageAt: number;
  streamingText: string;
  processingGeneration: number;
  name?: string;
  isFlagged: boolean;
  isArchived?: boolean;
  archivedAt?: number;
  permissionMode?: PermissionMode;
  previousPermissionMode?: PermissionMode;
  mcpPool?: McpClientPool;
  sdkSessionId?: string;
  needsPiMigrationSeed: boolean;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    contextTokens: number;
    costUsd: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    contextWindow?: number;
  };
  sessionStatus?: string;
  lastReadMessageId?: string;
  hasUnread?: boolean;
  enabledSourceSlugs?: string[];
  labels?: string[];
  workingDirectory: string;
  sdkCwd?: string;
  sharedUrl?: string;
  sharedId?: string;
  model?: string;
  llmConnection?: string;
  connectionLocked?: boolean;
  thinkingLevel?: ThinkingLevel;
  systemPromptPreset?: 'default' | 'mini' | string;
  lastMessageRole?: 'user' | 'assistant' | 'plan' | 'tool' | 'error';
  lastFinalMessageId?: string;
  turnStartFinalMessageId?: string;
  turnStartedAt?: number;
  pendingTurnMetrics?: Map<string, TurnMetrics>;
  pendingExternalMetadata?: SessionHeader;
  _metadataWriteGuardUntil?: number;
  isAsyncOperationOngoing?: boolean;
  preview?: string;
  createdAt?: number;
  messageCount?: number;
  messageQueue: Array<{
    message: string;
    attachments?: FileAttachment[];
    storedAttachments?: StoredAttachment[];
    options?: SendMessageOptions;
    messageId?: string;
    optimisticMessageId?: string;
  }>;
  backgroundShellCommands: Map<string, string>;
  backgroundTaskOutputs: Map<string, {
    outputFile: string;
    summary: string;
    status: string;
    completedAt: number;
  }>;
  messagesLoaded: boolean;
  pendingAuthRequestId?: string;
  pendingAuthRequest?: AuthRequest;
  lastSentMessage?: string;
  lastSentAttachments?: FileAttachment[];
  lastSentStoredAttachments?: StoredAttachment[];
  lastSentOptions?: SendMessageOptions;
  authRetryAttempted?: boolean;
  authRetrySafe?: boolean;
  authRetryInProgress?: boolean;
  hidden?: boolean;
  branchFromMessageId?: string;
  branchContextStrategy?: 'sdk-fork' | 'seeded-fresh-session';
  branchFromSdkSessionId?: string;
  branchFromSessionPath?: string;
  branchFromSdkCwd?: string;
  branchFromSdkTurnId?: string;
  branchSeedApplied?: boolean;
  transferredSessionSummary?: string;
  transferredSessionSummaryApplied?: boolean;
  tokenRefreshManager: TokenRefreshManager;
  triggeredBy?: { automationName?: string; event?: string; timestamp?: number };
  agentReady?: Promise<void>;
  agentReadyResolve?: () => void;
  envOverrides?: Record<string, string>;
  backendRuntimeSignature?: string;
  backendRestartSignature?: string;
  credentialRestartRequired?: boolean;
  wasInterrupted?: boolean;
}
