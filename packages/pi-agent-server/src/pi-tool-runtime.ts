// input: Pi tool definitions, Host permission handshakes, and product rewind callbacks
// output: Hooked Pi tools plus correlated Host tool and rewind requests
// pos: Tool execution boundary shared by primary Pi sessions and Extensions

import type {
  AgentSession,
  AgentToolResult,
  ToolCallEvent,
  ToolDefinition,
  ToolResultEvent,
} from '@earendil-works/pi-coding-agent';
import type {
  ImageContent as PiImageContent,
  TextContent as PiTextContent,
} from '@earendil-works/pi-ai';
import { handleLargeResponse, estimateTokens, tokenLimitFor } from '../../shared/src/utils/large-response.ts';
import { getSessionPath } from '../../shared/src/sessions/storage.ts';
import { PI_TOOL_NAME_MAP } from '../../shared/src/agent/backend/pi/constants.ts';
import type {
  ConversationRewindBoundary,
  ConversationRewindRequest,
  ConversationRewindResult,
} from '../../shared/src/agent/backend/types.ts';
import type {
  PiInitMessage,
  PiOutboundMessage,
  PiProxyToolDefinition,
} from '../../shared/src/agent/backend/pi/protocol.ts';
import { normalizeCraftToolArgumentsForSchema } from './craft-metadata-schema.ts';
import {
  PRODUCT_TREE_HEAD_TYPE,
  executeProductRewind,
} from './product-rewind.ts';
import { createToolHooks } from './tool-hooks.ts';

interface PiToolRuntimeContext {
  getConfig(): PiInitMessage | null;
  getProxyToolDefs(): PiProxyToolDefinition[];
  pendingPreToolUse: Map<string, {
    resolve(response: { action: string; input?: Record<string, unknown>; reason?: string }): void;
  }>;
  pendingToolExecutions: Map<string, {
    resolve(result: { content: string; isError: boolean }): void;
  }>;
  pendingConversationRewinds: Map<string, {
    resolve(result: ConversationRewindResult): void;
    reject(error: Error): void;
  }>;
  send(message: PiOutboundMessage): void;
  debug(message: string): void;
  runMiniCompletion(prompt: string): Promise<string | null>;
  preExecuteCallLlm(input: Record<string, unknown>): Promise<{ text: string; warning?: string }>;
}

export function createPiToolRuntime(context: PiToolRuntimeContext) {
  const {
    getConfig,
    getProxyToolDefs,
    pendingPreToolUse,
    pendingToolExecutions,
    pendingConversationRewinds,
    send,
    debug: debugLog,
    runMiniCompletion,
    preExecuteCallLlm,
  } = context;

interface SessionToolHookState {
  getSession(): AgentSession | null;
  getUserRequest(): string;
  intentByCallId: Map<string, string>;
  toolResultTokens: number;
}

function createSessionToolHooks(state: SessionToolHookState) {
  return createToolHooks({
    onTurnStart: () => { state.toolResultTokens = 0; },
    beforeToolCall: event => prepareToolInput(event, state.intentByCallId),
    afterToolCall: event => postprocessToolResult(event, state),
  });
}

/**
 * Shared permission enforcement for both coding tools and proxy tools.
 * Checks mode-manager rules and, in Ask mode, prompts the user via the
 * pending-permissions handshake. Throws on deny or block.
 */
/**
 * Send pre_tool_use_request to main process and wait for response.
 * Returns the (potentially modified) input if approved, throws if blocked.
 * All permission checking, transforms, and source activation happen in the main process.
 */
async function requestPreToolUseApproval(
  sdkToolName: string,
  input: Record<string, unknown>,
  toolCallId?: string,
): Promise<Record<string, unknown>> {
  const requestId = `pi-ptu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  send({
    type: 'pre_tool_use_request',
    requestId,
    toolName: sdkToolName,
    ...(toolCallId ? { toolCallId } : {}),
    input,
  });

  const response = await new Promise<{ action: string; input?: Record<string, unknown>; reason?: string }>((resolve) => {
    pendingPreToolUse.set(requestId, { resolve });
  });

  if (response.action === 'block') {
    throw new Error(response.reason || `Tool "${sdkToolName}" is not allowed`);
  }

  return response.action === 'modify' && response.input ? response.input : input;
}

function prepareToolDefinitions(tools: ToolDefinition<any, any>[]): ToolDefinition<any, any>[] {
  return tools.map((tool) => {
    const originalPrepareArguments = tool.prepareArguments;
    const prepareArguments: ToolDefinition<any, any>['prepareArguments'] = (args) => {
      const normalized = normalizeCraftToolArgumentsForSchema(tool.name, tool.parameters, args);
      return originalPrepareArguments ? originalPrepareArguments(normalized) : normalized;
    };

    return {
      ...tool,
      prepareArguments,
    };
  });
}

async function prepareToolInput(
  event: ToolCallEvent,
  intentByCallId: Map<string, string>,
): Promise<Record<string, unknown>> {
  const sdkToolName = PI_TOOL_NAME_MAP[event.toolName] || event.toolName;
  let input: Record<string, unknown> = { ...event.input };
  const intent = typeof input.description === 'string' ? input.description : undefined;

  // Normalize Pi SDK parameter names for the shared permission pipeline.
  if ((sdkToolName === 'Write' || sdkToolName === 'Edit' || sdkToolName === 'MultiEdit' || sdkToolName === 'NotebookEdit')
      && typeof input.path === 'string' && !input.file_path) {
    input = { ...input, file_path: input.path };
  }

  const approvedInput = await requestPreToolUseApproval(sdkToolName, input, event.toolCallId);
  if (intent) intentByCallId.set(event.toolCallId, intent);
  return approvedInput;
}

async function postprocessToolResult(
  event: ToolResultEvent,
  state: SessionToolHookState,
): Promise<{
  content?: (PiTextContent | PiImageContent)[];
  details?: unknown;
  isError?: boolean;
} | void> {
  const intent = state.intentByCallId.get(event.toolCallId);
  state.intentByCallId.delete(event.toolCallId);
  if (event.isError) return;

  const resultText = event.content
    .filter((content): content is PiTextContent => content.type === 'text')
    .map(content => content.text)
    .join('');
  const modelContextWindow = state.getSession()?.agent.state.model?.contextWindow;
  const resultTokens = estimateTokens(resultText);
  const remainingTokens = Math.max(0, tokenLimitFor(modelContextWindow) - state.toolResultTokens);
  const config = getConfig();
  if (resultTokens <= remainingTokens || !config) {
    state.toolResultTokens += resultTokens;
    return;
  }

  try {
    const sdkToolName = PI_TOOL_NAME_MAP[event.toolName] || event.toolName;
    const largeResult = await handleLargeResponse({
      text: resultText,
      sessionPath: getSessionPath(config.workspaceRootPath, config.sessionId),
      context: {
        toolName: sdkToolName,
        input: event.input,
        intent,
        userRequest: state.getUserRequest(),
      },
      summarize: runMiniCompletion,
      contextWindow: modelContextWindow,
      thresholdTokens: remainingTokens,
    });

    if (largeResult) {
      state.toolResultTokens += estimateTokens(largeResult.message);
      return {
        content: [{ type: 'text', text: largeResult.message }],
        details: event.details,
        isError: event.isError,
      };
    }
  } catch (error) {
    debugLog(
      `Large response handling failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  state.toolResultTokens += resultTokens;
}

function buildProxyTools(): ToolDefinition<any, any>[] {
  debugLog(`Building proxy tools from ${getProxyToolDefs().length} definitions: ${getProxyToolDefs().map(t => t.name).join(', ')}`);

  return getProxyToolDefs().map<ToolDefinition<any, any>>(def => ({
    name: def.name,
    label: def.name
      .replace(/^mcp__.*?__/, '')
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2'),
    description: def.description,
    // Pi SDK omits tools without promptSnippet from the system prompt's
    // "Available tools" section, making them invisible to the LLM.
    // Derive a snippet from the description so proxy tools are listed.
    promptSnippet: def.description.length > 200
      ? def.description.slice(0, 197) + '...'
      : def.description,
    parameters: def.inputSchema,
    execute: async (
      _toolCallId: string,
      params: any,
    ): Promise<AgentToolResult<any>> => {
      if (def.name === 'mcp__session__call_llm') {
        try {
          const result = await preExecuteCallLlm(params as Record<string, unknown>);
          return {
            content: [{ type: 'text', text: result.text || '(Model returned empty response)' }],
            details: result.warning ? { warning: result.warning } : undefined,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`call_llm failed: ${message}`);
        }
      }

      const result = await requestHostTool(def.name, params as Record<string, unknown>);

      return {
        content: [{ type: 'text', text: result.content }],
        details: result.isError ? { isError: true } : undefined,
      };
    },
  }));
}

function requestHostTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ content: string; isError: boolean }> {
  const requestId = `proxy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const result = new Promise<{ content: string; isError: boolean }>((resolve) => {
    pendingToolExecutions.set(requestId, { resolve });
  });
  send({ type: 'tool_execute_request', requestId, toolName, args });
  return result;
}

function requestConversationRewind(
  request: ConversationRewindRequest,
): Promise<ConversationRewindResult> {
  const requestId = `rewind-${request.phase}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const result = new Promise<ConversationRewindResult>((resolve, reject) => {
    pendingConversationRewinds.set(requestId, { resolve, reject });
  });
  send({ type: 'conversation_rewind_request', requestId, request });
  return result;
}

async function executeSessionRewind(
  session: AgentSession,
  targetId: string,
  options: Parameters<AgentSession['navigateTree']>[1],
  boundary: ConversationRewindBoundary,
) {
  return executeProductRewind(boundary, {
    prepare: async (preparedBoundary) => {
      const result = await requestConversationRewind({ phase: 'prepare', boundary: preparedBoundary });
      if (result.phase !== 'prepared') throw new Error(`Unexpected rewind prepare result: ${result.phase}`);
      return result;
    },
    navigate: () => session.navigateTree(targetId, options),
    currentLeaf: () => session.sessionManager.getLeafId(),
    restoreLeaf: async (leafId) => {
      if (!leafId) {
        session.sessionManager.resetLeaf();
        return;
      }
      const restored = await session.navigateTree(leafId, { summarize: false });
      if (restored.cancelled) throw new Error('Pi rewind rollback was cancelled');
    },
    appendHead: () => {
      session.sessionManager.appendCustomEntry(PRODUCT_TREE_HEAD_TYPE, { v: 1 });
    },
    commit: async ({ token, revision }) => {
      const result = await requestConversationRewind({
        phase: 'commit',
        token,
        expectedRevision: revision,
      });
      if (result.phase !== 'committed') throw new Error(`Unexpected rewind commit result: ${result.phase}`);
    },
    abort: async (token) => {
      const result = await requestConversationRewind({ phase: 'abort', token });
      if (result.phase !== 'aborted') throw new Error(`Unexpected rewind abort result: ${result.phase}`);
    },
  });
}


  return {
    createSessionToolHooks,
    prepareToolDefinitions,
    buildProxyTools,
    requestHostTool,
    requestConversationRewind,
    executeSessionRewind,
  };
}
