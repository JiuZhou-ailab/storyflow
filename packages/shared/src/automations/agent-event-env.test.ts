/**
 * Tests for agent-event-env.ts
 */

import { describe, it, expect } from 'bun:test';
import { buildEnvFromAgentInput } from './agent-event-env.ts';
import type { AgentAutomationInput } from './types.ts';

function input(overrides: Partial<AgentAutomationInput> = {}): AgentAutomationInput {
  return { hook_event_name: 'test', ...overrides };
}

describe('agent-event-env', () => {
  describe('buildEnvFromAgentInput', () => {
    it('should always include CRAFT_EVENT', () => {
      const env = buildEnvFromAgentInput('PreToolUse', input());
      expect(env.CRAFT_EVENT).toBe('PreToolUse');
    });

    it('should include process.env variables', () => {
      const env = buildEnvFromAgentInput('PreToolUse', input());
      // PATH should be inherited from process.env
      expect(env.PATH).toBeDefined();
    });

    it('should not include undefined values from process.env', () => {
      const env = buildEnvFromAgentInput('PreToolUse', input());
      // All values should be strings, none should be "undefined"
      for (const [, value] of Object.entries(env)) {
        expect(value).not.toBe('undefined');
        expect(typeof value).toBe('string');
      }
    });

    describe('PreToolUse / PostToolUse', () => {
      it('should map tool_name to CRAFT_TOOL_NAME', () => {
        const env = buildEnvFromAgentInput('PreToolUse', input({ tool_name: 'Bash' }));
        expect(env.CRAFT_TOOL_NAME).toBe('Bash');
      });

      it('should map tool_input as sanitized JSON', () => {
        const env = buildEnvFromAgentInput('PreToolUse', input({
          tool_name: 'Bash',
          tool_input: { command: 'ls -la' },
        }));
        expect(env.CRAFT_TOOL_INPUT).toBeDefined();
        expect(env.CRAFT_TOOL_INPUT).not.toContain('`');
      });

      it('should map tool_response for PostToolUse', () => {
        const env = buildEnvFromAgentInput('PostToolUse', input({
          tool_name: 'Bash',
          tool_response: 'file1.txt\nfile2.txt',
        }));
        expect(env.CRAFT_TOOL_RESPONSE).toBeDefined();
      });
    });

    describe('PostToolUseFailure', () => {
      it('should map error to CRAFT_ERROR', () => {
        const env = buildEnvFromAgentInput('PostToolUseFailure', input({
          tool_name: 'Bash',
          error: 'Command failed',
        }));
        expect(env.CRAFT_TOOL_NAME).toBe('Bash');
        expect(env.CRAFT_ERROR).toBeDefined();
      });
    });

    describe('UserPromptSubmit', () => {
      it('should sanitize user prompt', () => {
        const env = buildEnvFromAgentInput('UserPromptSubmit', input({
          prompt: 'Hello `world`',
        }));
        expect(env.CRAFT_PROMPT).toBeDefined();
        // Backticks should be escaped with backslash
        expect(env.CRAFT_PROMPT).toContain('\\`');
      });
    });

    describe('SessionStart', () => {
      it('should map source and model', () => {
        const env = buildEnvFromAgentInput('SessionStart', input({
          source: 'manual',
          model: 'claude-opus-4-7',
        }));
        expect(env.CRAFT_SOURCE).toBe('manual');
        expect(env.CRAFT_MODEL).toBe('claude-opus-4-7');
      });
    });

    describe('SubagentStart / SubagentStop', () => {
      it('should map agent_id and agent_type', () => {
        const env = buildEnvFromAgentInput('SubagentStart', input({
          agent_id: 'agent-123',
          agent_type: 'research',
        }));
        expect(env.CRAFT_AGENT_ID).toBe('agent-123');
        expect(env.CRAFT_AGENT_TYPE).toBe('research');
      });
    });

    describe('Notification', () => {
      it('should sanitize message and title', () => {
        const env = buildEnvFromAgentInput('Notification', input({
          message: 'Test `message`',
          title: 'Test `title`',
        }));
        expect(env.CRAFT_MESSAGE).toBeDefined();
        expect(env.CRAFT_TITLE).toBeDefined();
        // Backticks should be escaped
        expect(env.CRAFT_MESSAGE).toContain('\\`');
        expect(env.CRAFT_TITLE).toContain('\\`');
      });
    });

    describe('unknown/default events', () => {
      it('should return minimal env for events with no specific mappings', () => {
        const env = buildEnvFromAgentInput('Stop' as any, input());
        expect(env.CRAFT_EVENT).toBe('Stop');
        // Should still have process.env vars
        expect(env.PATH).toBeDefined();
      });
    });

    describe('shell injection prevention', () => {
      it('should sanitize user-controlled fields', () => {
        const env = buildEnvFromAgentInput('UserPromptSubmit', input({
          prompt: '$(rm -rf /)',
        }));
        // $ should be escaped with backslash to prevent command substitution
        expect(env.CRAFT_PROMPT).toContain('\\$');
      });

      it('should not sanitize internal fields like tool_name', () => {
        const env = buildEnvFromAgentInput('PreToolUse', input({
          tool_name: 'Bash',
        }));
        // tool_name is internal, should be passed through as-is
        expect(env.CRAFT_TOOL_NAME).toBe('Bash');
      });
    });
  });
});
