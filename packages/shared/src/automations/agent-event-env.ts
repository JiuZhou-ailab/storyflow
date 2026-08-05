/**
 * Agent Event Environment - environment variable building for agent automations
 *
 * Maps normalized agent event input fields to CRAFT_* environment variables.
 */

import { sanitizeForShell } from './security.ts';
import { cleanEnv } from './utils.ts';
import type { AgentAutomationInput, AgentEvent } from './types.ts';

/**
 * Build environment variables from normalized agent automation input.
 */
export function buildEnvFromAgentInput(event: AgentEvent, input: AgentAutomationInput): Record<string, string> {
  const env: Record<string, string> = {
    ...cleanEnv(),
    CRAFT_EVENT: event,
  };

  // Map agent input fields to env vars based on event type
  // User-provided values are sanitized to prevent shell injection
  switch (event) {
    case 'PreToolUse':
    case 'PostToolUse':
      if (input.tool_name) env.CRAFT_TOOL_NAME = input.tool_name; // Tool names are internal, not user input
      if (input.tool_input) env.CRAFT_TOOL_INPUT = sanitizeForShell(JSON.stringify(input.tool_input));
      if (input.tool_response) env.CRAFT_TOOL_RESPONSE = sanitizeForShell(input.tool_response);
      break;

    case 'PostToolUseFailure':
      if (input.tool_name) env.CRAFT_TOOL_NAME = input.tool_name;
      if (input.tool_input) env.CRAFT_TOOL_INPUT = sanitizeForShell(JSON.stringify(input.tool_input));
      if (input.error) env.CRAFT_ERROR = sanitizeForShell(input.error);
      break;

    case 'UserPromptSubmit':
      // User prompts are user-controlled and must be sanitized
      if (input.prompt) env.CRAFT_PROMPT = sanitizeForShell(input.prompt);
      break;

    case 'SessionStart':
      if (input.source) env.CRAFT_SOURCE = input.source; // Internal values
      if (input.model) env.CRAFT_MODEL = input.model;
      break;

    case 'SubagentStart':
    case 'SubagentStop':
      if (input.agent_id) env.CRAFT_AGENT_ID = input.agent_id; // Internal values
      if (input.agent_type) env.CRAFT_AGENT_TYPE = input.agent_type;
      break;

    case 'Notification':
      // Notification content could contain user data
      if (input.message) env.CRAFT_MESSAGE = sanitizeForShell(input.message);
      if (input.title) env.CRAFT_TITLE = sanitizeForShell(input.title);
      break;

    // SessionEnd, Stop, PreCompact, PermissionRequest, Setup have no additional fields
    default:
      break;
  }

  return env;
}
