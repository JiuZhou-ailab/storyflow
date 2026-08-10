// input: Host commands, Pi runtime events, credentials, and request correlation identifiers
// output: One typed JSONL protocol shared by the Pi host client and subprocess server
// pos: Stable process boundary between Storyflow orchestration and the Pi execution runtime

import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { ModelThinkingLevelMap } from '../../../config/models.ts';
import type { LLMQueryRequest, LLMQueryResult } from '../../llm-tool.ts';
import type {
  ConversationRewindRequest,
  ConversationRewindResult,
} from '../types.ts';
import type { ConversationRewindErrorCode } from '../../../protocol/dto.ts';

export type PiCredential =
  | { type: 'api_key'; key: string }
  | { type: 'oauth'; access: string; refresh: string; expires: number }
  | {
      type: 'iam';
      accessKeyId: string;
      secretAccessKey: string;
      region?: string;
      sessionToken?: string;
    };

export type PiCustomEndpointApi =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generative-ai';

export type PiCustomEndpointModelConfig = string | {
  id: string;
  contextWindow?: number;
  supportsImages?: boolean;
  supportsThinking?: boolean;
  thinkingLevelMap?: ModelThinkingLevelMap;
};

export interface PiProxyToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface PiInitMessage {
  type: 'init';
  apiKey: string;
  model: string;
  cwd: string;
  thinkingLevel: string;
  workspaceRootPath: string;
  projectRoot?: string;
  sessionId: string;
  sessionPath: string;
  workingDirectory: string;
  plansFolderPath: string;
  miniModel?: string;
  agentDir?: string;
  providerType?: string;
  authType?: string;
  workspaceId?: string;
  baseUrl?: string;
  branchFromSdkSessionId?: string;
  branchFromSessionPath?: string;
  branchFromSdkTurnId?: string;
  customEndpoint?: { api: PiCustomEndpointApi; supportsImages?: boolean };
  customModels?: PiCustomEndpointModelConfig[];
  piAuth?: { provider: string; credential: PiCredential };
  enable1MContext?: boolean;
}

export interface PiRuntimeConfigUpdateMessage {
  type: 'update_runtime_config';
  id: string;
  model: string;
  providerType?: string;
  authType?: string;
  baseUrl?: string;
  customEndpoint?: { api: PiCustomEndpointApi; supportsImages?: boolean };
  customModels?: PiCustomEndpointModelConfig[];
}

export type PiInboundMessage =
  | PiInitMessage
  | {
      type: 'prompt';
      id: string;
      message: string;
      systemPrompt: string;
      dynamicSystemPrompt?: string;
      images?: Array<{ type: 'image'; data: string; mimeType: string }>;
      rewindBoundary?: {
        visibleUserMessageId?: string;
        retainThroughMessageId: string | null;
        draftText?: string;
      };
    }
  | { type: 'register_tools'; tools: PiProxyToolDefinition[] }
  | {
      type: 'tool_execute_response';
      requestId: string;
      result: { content: string; isError: boolean };
    }
  | {
      type: 'pre_tool_use_response';
      requestId: string;
      action: 'allow' | 'block' | 'modify';
      input?: Record<string, unknown>;
      reason?: string;
    }
  | { type: 'abort' }
  | { type: 'llm_query'; id: string; request: LLMQueryRequest }
  | { type: 'ensure_session_ready'; id: string }
  | { type: 'set_model'; model: string }
  | { type: 'set_thinking_level'; level: string }
  | { type: 'compact'; id: string; customInstructions?: string }
  | { type: 'rewind_user_message'; id: string; visibleUserMessageId: string }
  | {
      type: 'conversation_rewind_response';
      requestId: string;
      success: boolean;
      result?: ConversationRewindResult;
      errorMessage?: string;
    }
  | PiRuntimeConfigUpdateMessage
  | { type: 'steer'; message: string }
  | {
      type: 'token_update';
      id: string;
      piAuth: { provider: string; credential: PiCredential };
    }
  | { type: 'shutdown' };

type EnrichedAssistantMessageEndEvent = Extract<AgentSessionEvent, { type: 'message_end' }> & {
  sdkTurnAnchor?: string;
  contextWindow?: number;
};

export type PiOutboundAgentEvent = AgentSessionEvent | EnrichedAssistantMessageEndEvent;

export type PiOutboundMessage =
  | { type: 'ready'; sessionId: string | null }
  | { type: 'event'; event: PiOutboundAgentEvent }
  | { type: 'prompt_result'; id: string; status: 'completed_without_agent' | 'failed' }
  | {
      type: 'pre_tool_use_request';
      requestId: string;
      toolName: string;
      toolCallId?: string;
      input: Record<string, unknown>;
    }
  | {
      type: 'tool_execute_request';
      requestId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: 'llm_query_result';
      id: string;
      result: LLMQueryResult | null;
      errorMessage?: string;
      errorCode?: string;
    }
  | { type: 'ensure_session_ready_result'; id: string; sessionId: string | null }
  | {
      type: 'compact_result';
      id: string;
      success: boolean;
      result?: { summary: string; firstKeptEntryId: string; tokensBefore: number };
      errorMessage?: string;
    }
  | {
      type: 'rewind_user_message_result';
      id: string;
      success: boolean;
      editorText?: string;
      errorCode?: ConversationRewindErrorCode;
      errorMessage?: string;
    }
  | {
      type: 'update_runtime_config_result';
      id: string;
      success: boolean;
      updated: boolean;
      errorMessage?: string;
    }
  | { type: 'session_id_update'; sessionId: string }
  | {
      type: 'extension_notification';
      message: string;
      level?: 'info' | 'warning' | 'error';
    }
  | {
      type: 'conversation_rewind_request';
      requestId: string;
      request: ConversationRewindRequest;
    }
  | {
      type: 'credential_update';
      provider: string;
      credential: Extract<PiCredential, { type: 'oauth' }>;
    }
  | { type: 'token_update_result'; id: string; success: boolean; errorMessage?: string }
  | { type: 'error'; message: string; code?: string };
