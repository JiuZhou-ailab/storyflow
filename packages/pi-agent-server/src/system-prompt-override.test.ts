// input: Storyflow prompts, representative Skill metadata, and a fake Pi Extension API
// output: Regression assertions for Pi-native per-turn prompt injection
// pos: Contract test for the Storyflow-to-Pi prompt Extension

import { describe, expect, it } from 'bun:test';
import {
  type BeforeAgentStartEvent,
  type BeforeAgentStartEventResult,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent';
import { fingerprintTools } from './prompt-cache-profile.ts';
import { createSystemPromptOverride } from './system-prompt-override.ts';

function registerHandler(controller: ReturnType<typeof createSystemPromptOverride>) {
  let handler: (
    event: BeforeAgentStartEvent,
    context: never,
  ) => BeforeAgentStartEventResult | void | Promise<BeforeAgentStartEventResult | void>;
  const factory = typeof controller.extension === 'function'
    ? controller.extension
    : controller.extension.factory;
  factory({
    on(event, nextHandler) {
      if (event === 'before_agent_start') {
        handler = nextHandler as typeof handler;
      }
    },
  } as ExtensionAPI);
  return (systemPrompt = 'PI_DEFAULT') => handler!({
    type: 'before_agent_start',
    prompt: 'Hello',
    systemPrompt,
    systemPromptOptions: {
      cwd: '/workspace',
      contextFiles: [],
      skills: [],
    },
  }, undefined as never);
}

describe('createSystemPromptOverride', () => {
  it('provides the Storyflow base prompt through Pi ResourceLoader', () => {
    const controller = createSystemPromptOverride();

    expect(controller.overrideResourcePrompt('PI_USER_SYSTEM')).toBe('PI_USER_SYSTEM');

    controller.set('STORYFLOW_BASE');

    expect(controller.overrideResourcePrompt('PI_USER_SYSTEM')).toBe(
      'STORYFLOW_BASE\n\nPI_USER_SYSTEM',
    );
  });

  it('preserves Pi-native AGENTS.md and Skill assembly, then appends dynamic context', async () => {
    const controller = createSystemPromptOverride();
    const run = registerHandler(controller);
    const piAssembledPrompt = `STORYFLOW_BASE

<project_context>
<project_instructions path="/home/user/.pi/agent/AGENTS.md">
Reply in Chinese.
</project_instructions>
</project_context>

<skills>
<name>outline-architecture</name>
</skills>
Current date: 2026-08-07
Current working directory: /workspace`;

    controller.set('STORYFLOW_BASE', '<session_state>ASK</session_state>');
    const result = await run(piAssembledPrompt);

    expect(result?.systemPrompt).toBe(
      `${piAssembledPrompt}\n\n<session_state>ASK</session_state>`,
    );
    expect(result?.systemPrompt.match(/Reply in Chinese\./g)).toHaveLength(1);
    expect(result?.systemPrompt.match(/<name>outline-architecture<\/name>/g)).toHaveLength(1);
  });

  it('fingerprints Pi native assembly without volatile dynamic context', async () => {
    const controller = createSystemPromptOverride();
    const run = registerHandler(controller);
    const stablePrompt = 'STORYFLOW_BASE\n\n<project_context>RULES</project_context>';

    controller.set('STORYFLOW_BASE', 'DYNAMIC ONE');
    await run(stablePrompt);
    const firstHash = controller.getStablePrefixHash();

    controller.set('STORYFLOW_BASE', 'DYNAMIC TWO');
    await run(stablePrompt);

    expect(controller.getStablePrefixHash()).toBe(firstHash);
    expect(firstHash).not.toBeNull();
  });

  it('does not replace Pi assembly before Storyflow provides a prompt', async () => {
    const controller = createSystemPromptOverride();
    const run = registerHandler(controller);

    expect(await run('PI_DEFAULT')).toBeUndefined();
  });

  it('fingerprints the serialized toolset independently of registration order', () => {
    const tools = [
      { name: 'zeta', description: 'Z', parameters: { type: 'object' } },
      { name: 'alpha', description: 'A', parameters: { type: 'object' } },
    ];

    expect(fingerprintTools(tools)).toBe(fingerprintTools([...tools].reverse()));
    expect(fingerprintTools(tools)).not.toBe(fingerprintTools([
      { ...tools[0], description: 'changed' },
      tools[1],
    ]));
  });
});
