// input: Storyflow prompts, transient context, Skill metadata, and a fake Pi Extension API
// output: Regression assertions for stable system prompts and non-persistent turn projection
// pos: Contract test for the Storyflow-to-Pi prompt Extension

import { describe, expect, it } from 'bun:test';
import {
  type BeforeAgentStartEvent,
  type BeforeAgentStartEventResult,
  type ContextEvent,
  type ContextEventResult,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent';
import { fingerprintTools } from './prompt-cache-profile.ts';
import { createSystemPromptOverride } from './system-prompt-override.ts';

function registerHandlers(controller: ReturnType<typeof createSystemPromptOverride>) {
  let beforeAgentStartHandler: (
    event: BeforeAgentStartEvent,
    context: never,
  ) => BeforeAgentStartEventResult | void | Promise<BeforeAgentStartEventResult | void>;
  let contextHandler: (
    event: ContextEvent,
    context: never,
  ) => ContextEventResult | void | Promise<ContextEventResult | void>;
  const factory = typeof controller.extension === 'function'
    ? controller.extension
    : controller.extension.factory;
  factory({
    on(event, nextHandler) {
      if (event === 'before_agent_start') {
        beforeAgentStartHandler = nextHandler as typeof beforeAgentStartHandler;
      } else if (event === 'context') {
        contextHandler = nextHandler as typeof contextHandler;
      }
    },
  } as ExtensionAPI);
  return {
    runBeforeAgentStart: (systemPrompt = 'PI_DEFAULT') => beforeAgentStartHandler!({
      type: 'before_agent_start',
      prompt: 'Hello',
      systemPrompt,
      systemPromptOptions: {
        cwd: '/workspace',
        contextFiles: [],
        skills: [],
      },
    }, undefined as never),
    runContext: (messages: ContextEvent['messages']) => contextHandler!({
      type: 'context',
      messages,
    }, undefined as never),
  };
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

  it('keeps Pi-native assembly stable and projects turn context only into the model view', async () => {
    const controller = createSystemPromptOverride();
    const { runBeforeAgentStart, runContext } = registerHandlers(controller);
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

    controller.set(
      'STORYFLOW_BASE',
      '<session_state>ASK</session_state>',
      '<workspace_root>/workspace</workspace_root>',
    );
    const beforeStart = await runBeforeAgentStart(piAssembledPrompt);
    expect(beforeStart?.systemPrompt).toContain('<session_state>ASK</session_state>');
    expect(beforeStart?.systemPrompt).not.toContain('<workspace_root>');

    const originalMessages = [
      { role: 'user', content: [{ type: 'text', text: 'Earlier request' }], timestamp: 1 },
      { role: 'user', content: [{ type: 'text', text: 'Current request' }], timestamp: 2 },
    ] as ContextEvent['messages'];
    const result = await runContext(originalMessages);
    const projectedMessages = result?.messages;
    expect(projectedMessages).toBeDefined();
    expect(projectedMessages?.[0]).toEqual(originalMessages[0]);
    const projectedUser = projectedMessages?.[1];
    expect(projectedUser?.role).toBe('user');
    if (!projectedUser || projectedUser.role !== 'user' || !Array.isArray(projectedUser.content)) {
      throw new Error('expected projected user message content');
    }
    expect(projectedUser.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('<workspace_root>/workspace</workspace_root>'),
    });
    expect(projectedUser.content[1]).toEqual({ type: 'text', text: 'Current request' });
    expect(JSON.stringify(projectedMessages)).not.toContain('<session_state>ASK</session_state>');
    expect(JSON.stringify(originalMessages)).not.toContain('<workspace_root>');

    const secondProjection = await runContext(originalMessages);
    expect(JSON.stringify(secondProjection?.messages).match(/<workspace_root>/g))
      .toHaveLength(1);
  });

  it('fingerprints Pi native assembly without volatile dynamic context', async () => {
    const controller = createSystemPromptOverride();
    const { runBeforeAgentStart } = registerHandlers(controller);
    const stablePrompt = 'STORYFLOW_BASE\n\n<project_context>RULES</project_context>';

    controller.set('STORYFLOW_BASE', 'DYNAMIC ONE', 'DATA ONE');
    await runBeforeAgentStart(stablePrompt);
    const firstHash = controller.getStablePrefixHash();

    controller.set('STORYFLOW_BASE', 'DYNAMIC TWO', 'DATA TWO');
    await runBeforeAgentStart(stablePrompt);

    expect(controller.getStablePrefixHash()).toBe(firstHash);
    expect(firstHash).not.toBeNull();
  });

  it('does not replace Pi assembly before Storyflow provides a prompt', async () => {
    const controller = createSystemPromptOverride();
    const { runBeforeAgentStart, runContext } = registerHandlers(controller);

    expect(await runBeforeAgentStart('PI_DEFAULT')).toBeUndefined();
    expect(await runContext([
      { role: 'user', content: [{ type: 'text', text: 'Hello' }], timestamp: 1 },
    ] as ContextEvent['messages'])).toBeUndefined();
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
