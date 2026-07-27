// input: Session identity, Storyflow workspace scope, and canonical tool definitions
// output: Claude SDK MCP tools bound to shared session handlers
// pos: In-process Claude adapter for provider-independent session tools

/**
 * Session-Scoped Tools
 *
 * Tools that are scoped to a specific session. Each session gets its own
 * instance of these tools with session-specific callbacks and state.
 *
 * This file is a thin adapter that wraps the shared handlers from
 * @craft-agent/session-tools-core for use with the Claude SDK.
 *
 * All tool definitions, schemas, and handlers live in session-tools-core.
 * This adapter only handles:
 * - Session callback registry (per-session onPlanSubmitted, onAuthRequest, queryFn)
 * - Plan state management
 * - Claude SDK tool() wrapping with DOC_REF-enriched descriptions
 * - call_llm (backend-specific, not in registry)
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { getSessionPath } from '../sessions/storage.ts';
import { DOC_REFS } from '../docs/index.ts';
import { createClaudeContext } from './claude-context.ts';
import { basename } from 'node:path';

// Import from session-tools-core: registry + schemas + base descriptions
import {
  SESSION_BACKEND_TOOL_NAMES,
  SESSION_TOOL_REGISTRY,
  getSessionToolDefs,
  TOOL_DESCRIPTIONS as BASE_DESCRIPTIONS,
  // Types
  type ToolResult,
  type AuthRequest,
} from '@craft-agent/session-tools-core';
import { createLLMTool } from './claude-llm-tool.ts';
import type { LLMQueryRequest, LLMQueryResult } from './llm-tool.ts';
import { createSpawnSessionTool, type SpawnSessionFn } from './spawn-session-tool.ts';
import { createBrowserTools, type BrowserPaneFns } from './browser-tools.ts';
import { FEATURE_FLAGS } from '../feature-flags.ts';
import { getBrowserToolEnabled } from '../config/storage.ts';

// Re-export types for backward compatibility
export type {
  CredentialInputMode,
  AuthRequestType,
  AuthRequest,
  AuthResult,
  CredentialAuthRequest,
  McpOAuthAuthRequest,
  GoogleOAuthAuthRequest,
  SlackOAuthAuthRequest,
  MicrosoftOAuthAuthRequest,
  GoogleService,
  SlackService,
  MicrosoftService,
} from '@craft-agent/session-tools-core';

// Re-export browser pane types for session manager wiring
export type { BrowserPaneFns } from './browser-tools.ts';

// ============================================================
// Session-Scoped Tool Callbacks (re-exported from dedicated registry module)
// ============================================================

// Re-export for all downstream consumers (index.ts, claude-agent.ts, pi-agent.ts, etc.)
export {
  type SessionScopedToolCallbacks,
  registerSessionScopedToolCallbacks,
  mergeSessionScopedToolCallbacks,
  unregisterSessionScopedToolCallbacks,
  getSessionScopedToolCallbacks,
} from './session-scoped-tool-callback-registry.ts';

// Local imports for use within this file's factory function
import { getSessionScopedToolCallbacks } from './session-scoped-tool-callback-registry.ts';
import { attachSessionSelfManagementBindings } from './session-self-management-bindings.ts';
import { registerSessionToolCacheInvalidator } from './session-tool-cache-invalidation.ts';
import {
  setLastPlanFilePath,
} from './session-plan-state.ts';
export {
  clearPlanFileState,
  getLastPlanFilePath,
  getSessionPlansDir,
  isPathInPlansDir,
  setLastPlanFilePath,
} from './session-plan-state.ts';

/** Backend-executed session tools currently supported by the Claude adapter layer. */
export const CLAUDE_BACKEND_SESSION_TOOL_NAMES = new Set<string>([
  'call_llm',
  'spawn_session',
  'browser_tool',
]);

/**
 * Guardrail: ensure Claude adapter wiring stays in sync with backend-mode tools
 * declared in session-tools-core. Fail fast during setup instead of runtime drift.
 */
function assertClaudeBackendSessionToolParity(): void {
  const missing = [...SESSION_BACKEND_TOOL_NAMES].filter(
    (name) => !CLAUDE_BACKEND_SESSION_TOOL_NAMES.has(name),
  );

  if (missing.length > 0) {
    throw new Error(
      `Claude session tools missing backend adapter implementations: ${missing.join(', ')}`,
    );
  }
}

// ============================================================
// Tool Result Converter
// ============================================================

/**
 * Convert shared ToolResult to SDK format
 */
function convertResult(result: ToolResult): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  return {
    content: result.content.map(c => ({ type: 'text' as const, text: c.text })),
    ...(result.isError ? { isError: true } : {}),
  };
}

// ============================================================
// Cache for Session-Scoped Tools
// ============================================================

// Cache tools by session to avoid recreating them on every query.
// We cache the tools array (expensive to build) but NOT the MCP server wrapper,
// because createSdkMcpServer returns an MCP Server instance that holds transport
// state. The SDK's query() calls connect() on it, setting _transport. On the next
// query(), connect() is called again — but if the previous Query's subprocess hasn't
// fully exited yet, _transport is still set and connect() throws
// "Already connected to a transport". Creating a fresh server wrapper per query avoids this.
const sessionToolsCache = new Map<string, ReturnType<typeof tool>[]>();

/**
 * Invalidate ALL session tool caches (e.g., when a global setting like browserToolEnabled changes).
 * This forces tools to be rebuilt on the next message for every session.
 */
export function invalidateAllSessionToolsCaches(): void {
  sessionToolsCache.clear();
}

registerSessionToolCacheInvalidator(invalidateAllSessionToolsCaches);

/**
 * Clean up cached tools for a session
 */
export function cleanupSessionScopedTools(sessionId: string): void {
  const prefix = `${sessionId}::`;
  for (const key of sessionToolsCache.keys()) {
    if (key.startsWith(prefix)) {
      sessionToolsCache.delete(key);
    }
  }
}

// ============================================================
// Tool Descriptions (base from registry + Claude-specific DOC_REFS)
// ============================================================

const TOOL_DESCRIPTIONS: Record<string, string> = {
  ...BASE_DESCRIPTIONS,
  // Claude-specific enrichments with DOC_REFs
  config_validate: BASE_DESCRIPTIONS.config_validate + `\n\n**Reference:** ${DOC_REFS.sources}`,
  skill_create: BASE_DESCRIPTIONS.skill_create + `\n\n**Reference:** ${DOC_REFS.skills}`,
  skill_validate: BASE_DESCRIPTIONS.skill_validate + `\n\n**Reference:** ${DOC_REFS.skills}`,
  mermaid_validate: BASE_DESCRIPTIONS.mermaid_validate + `\n\n**Reference:** ${DOC_REFS.mermaid}`,
  source_test: BASE_DESCRIPTIONS.source_test + `\n\n**Reference:** ${DOC_REFS.sources}`,
};

// ============================================================
// Main Factory Function
// ============================================================

/**
 * Get or create session-scoped tools for a session.
 * Returns an MCP server with all session-scoped tools registered.
 *
 * All tools come from the canonical SESSION_TOOL_DEFS registry in session-tools-core,
 * except call_llm which is backend-specific.
 */
export function getSessionScopedTools(
  sessionId: string,
  workspaceRootPath: string,
  workspaceId?: string
): ReturnType<typeof createSdkMcpServer> {
  const cacheKey = `${sessionId}::${workspaceRootPath}`;

  // Return cached tools if available, but always create a fresh MCP server wrapper
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tools: any[] | undefined = sessionToolsCache.get(cacheKey);
  if (!tools) {
    // Create Claude context with full capabilities
    const ctx = createClaudeContext({
      sessionId,
      workspacePath: workspaceRootPath,
      workspaceId: workspaceId || basename(workspaceRootPath) || '',
      onPlanSubmitted: (planPath: string) => {
        setLastPlanFilePath(sessionId, planPath);
        const callbacks = getSessionScopedToolCallbacks(sessionId);
        callbacks?.onPlanSubmitted?.(planPath);
      },
      onAuthRequest: (request: unknown) => {
        const callbacks = getSessionScopedToolCallbacks(sessionId);
        callbacks?.onAuthRequest?.(request as AuthRequest);
      },
      onAskUserQuestion: async (request) => {
        const callback = getSessionScopedToolCallbacks(sessionId)?.askUserQuestionFn;
        if (!callback) throw new Error('Interactive questions are not supported by this host.');
        return callback(request);
      },
    });

    // Attach session self-management bindings (lazy getters from callback registry)
    attachSessionSelfManagementBindings(ctx, sessionId);

    // Helper to create a tool from the canonical registry.
    // The `as any` on schema bridges a Zod generic-variance issue when .shape
    // types (ZodType<string>) flow into Record<string, ZodType<unknown>>.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function registryTool(name: string, schema: any) {
      const def = SESSION_TOOL_REGISTRY.get(name)!;
      return tool(name, TOOL_DESCRIPTIONS[name] || def.description, schema, async (args: any) => {
        const result = await def.handler!(ctx, args);
        return convertResult(result);
      }, def.readOnly ? { annotations: { readOnlyHint: true } } : undefined);
    }

    // Ensure backend-mode tool wiring is in sync with core metadata.
    assertClaudeBackendSessionToolParity();

    // Create tools from the canonical registry — all tools with handlers.
    // Tool visibility is centrally filtered in session-tools-core to avoid backend drift.
    tools = getSessionToolDefs({ includeDeveloperFeedback: FEATURE_FLAGS.developerFeedback })
      .filter(def => def.handler !== null) // Skip backend-specific tools (call_llm)
      .map(def => registryTool(def.name, def.inputSchema.shape));

    // Add call_llm — backend-specific (not in registry handler)
    const sessionPath = getSessionPath(workspaceRootPath, sessionId);
    tools.push(
      createLLMTool({
        sessionId,
        sessionPath,
        getQueryFn: () => {
          const callbacks = getSessionScopedToolCallbacks(sessionId);
          return callbacks?.queryFn;
        },
      }),
    );

    // Add spawn_session — backend-specific (not in registry handler)
    tools.push(
      createSpawnSessionTool({
        sessionId,
        getSpawnSessionFn: () => {
          const callbacks = getSessionScopedToolCallbacks(sessionId);
          return callbacks?.spawnSessionFn;
        },
      }),
    );

    // Add browser_* tools — backend-specific (requires BrowserPaneManager in Electron)
    // Gated by the "Built-in browser" setting so users with external browser tools
    // (Playwright, Puppeteer, etc.) can disable the built-in one.
    if (getBrowserToolEnabled()) {
      tools.push(
        ...createBrowserTools({
          sessionId,
          getBrowserPaneFns: () => {
            const callbacks = getSessionScopedToolCallbacks(sessionId);
            return callbacks?.browserPaneFns;
          },
        }),
      );
    }

    sessionToolsCache.set(cacheKey, tools);
  }

  // Always create a fresh MCP server wrapper to avoid "Already connected to a transport"
  // race condition when queries are sent back-to-back (see comment on sessionToolsCache).
  return createSdkMcpServer({
    name: 'session',
    version: '1.0.0',
    tools,
  });
}
