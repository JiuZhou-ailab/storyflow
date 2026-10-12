// input: Storyflow prompts, transient context, Skill metadata, and a fake Pi Extension API
// output: Regression assertions for stable system prompts and non-persistent turn projection
// pos: Contract test for the Storyflow-to-Pi prompt Extension

import { describe, expect, it } from 'bun:test';
import {
  SessionManager,
  type BeforeAgentStartEvent,
  type BeforeAgentStartEventResult,
  type ContextEvent,
  type ContextEventResult,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent';
import { fingerprintTools } from './prompt-cache-profile.ts';
import { createSystemPromptOverride } from './system-prompt-override.ts';

function registerHandlers(controller: ReturnType<typeof createSystemPromptOverride>, sessionManager = SessionManager.inMemory()) {
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
    sessionManager,
    runBeforeAgentStart: (systemPrompt = 'PI_DEFAULT') => beforeAgentStartHandler!({
      type: 'before_agent_start',
      prompt: 'Hello',
      systemPrompt,
      systemPromptOptions: {
        cwd: '/workspace',
        contextFiles: [],
        skills: [],
      },
    }, { sessionManager } as never),
    runContext: (messages: ContextEvent['messages']) => contextHandler!({
      type: 'context',
      messages,
    }, { sessionManager } as never),
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
    const { runBeforeAgentStart, runContext, sessionManager } = registerHandlers(controller);
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
    sessionManager.appendMessage({ role: 'user', content: [{ type: 'text', text: 'Earlier request' }], timestamp: 1 });
    const beforeStart = await runBeforeAgentStart(piAssembledPrompt);
    expect(beforeStart?.systemPrompt).toContain('<session_state>ASK</session_state>');
    expect(beforeStart?.systemPrompt).not.toContain('<workspace_root>');

    const originalMessages = [
      { role: 'user', content: [{ type: 'text', text: 'Earlier request' }], timestamp: 1 },
      { role: 'user', content: [{ type: 'text', text: 'Current request' }], timestamp: 2 },
    ] as ContextEvent['messages'];
    sessionManager.appendMessage(originalMessages[1]!);
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

  it('replays first contexts across clones, duplicate timestamps, steer and extension reload', async () => {
    const controller = createSystemPromptOverride();
    const first = registerHandlers(controller);
    controller.set('BASE', undefined, 'CONTEXT_ONE');
    await first.runBeforeAgentStart();
    const user = { role: 'user' as const, content: 'identical text', timestamp: 1 };
    first.sessionManager.appendMessage(user);
    const initial = await first.runContext(structuredClone([user]));
    expect(JSON.stringify(initial)).toContain('CONTEXT_ONE');

    controller.set('BASE', undefined, 'CONTEXT_TWO');
    const second = registerHandlers(controller, first.sessionManager);
    await second.runBeforeAgentStart();
    second.sessionManager.appendMessage(user);
    const next = await second.runContext(structuredClone([user, user]));
    expect(next?.messages[0]).toEqual(initial?.messages[0]);
    expect(JSON.stringify(next?.messages[1])).toContain('CONTEXT_TWO');
    // A steer has no before_agent_start; it belongs to the current turn.
    second.sessionManager.appendMessage(user);
    const steered = await second.runContext(structuredClone([user, user, user]));
    expect(steered?.messages.slice(0, 2)).toEqual(next?.messages);
    expect(JSON.stringify(steered?.messages[2])).toContain('CONTEXT_TWO');
    expect(JSON.stringify(second.sessionManager.buildSessionContext())).not.toContain('CONTEXT_');
  });

  it('does not backfill historical messages after process restart or an empty-context turn', async () => {
    const controller = createSystemPromptOverride();
    const { sessionManager, runBeforeAgentStart, runContext } = registerHandlers(controller);
    const old = { role: 'user' as const, content: 'old', timestamp: 1 };
    sessionManager.appendMessage(old);
    controller.set('BASE', undefined, 'NEW_CONTEXT');
    await runBeforeAgentStart();
    const current = { ...old, content: 'current' };
    sessionManager.appendMessage(current);
    const projected = await runContext([old, current]);
    expect(projected?.messages[0]).toEqual(old);
    expect(JSON.stringify(projected?.messages[1])).toContain('NEW_CONTEXT');

    controller.set('BASE');
    await runBeforeAgentStart();
    const empty = { ...old, content: 'empty' };
    sessionManager.appendMessage(empty);
    const noContext = await runContext([old, current, empty]);
    expect(noContext?.messages[1]).toEqual(projected?.messages[1]);
    expect(noContext?.messages[2]).toEqual(empty);

    controller.set('BASE', undefined, 'LATER_CONTEXT');
    await runBeforeAgentStart();
    const later = { ...old, content: 'later' };
    sessionManager.appendMessage(later);
    const final = await runContext([old, current, empty, later]);
    expect(final?.messages.slice(0, 3)).toEqual(noContext?.messages);
    expect(JSON.stringify(final?.messages[3])).toContain('LATER_CONTEXT');
  });

  it('follows native branch and compaction projections without changing snapshot identity', async () => {
    const controller = createSystemPromptOverride();
    const { sessionManager, runBeforeAgentStart, runContext } = registerHandlers(controller);
    const user = { role: 'user' as const, content: 'same', timestamp: 1 };
    controller.set('BASE', undefined, 'FIRST');
    await runBeforeAgentStart();
    const firstId = sessionManager.appendMessage(user);
    const first = await runContext(structuredClone(sessionManager.buildSessionProjection().messages));
    controller.set('BASE', undefined, 'SECOND');
    await runBeforeAgentStart();
    const secondId = sessionManager.appendMessage(user);
    const second = await runContext(structuredClone(sessionManager.buildSessionProjection().messages));
    sessionManager.appendCompaction('Earlier history summary', secondId, 100);
    const compacted = await runContext(structuredClone(sessionManager.buildSessionProjection().messages));
    expect(compacted?.messages.filter(message => message.role === 'user')).toEqual([second!.messages[1]!]);

    sessionManager.branch(firstId);
    controller.set('BASE', undefined, 'BRANCH');
    await runBeforeAgentStart();
    sessionManager.appendMessage(user);
    const branched = await runContext(structuredClone(sessionManager.buildSessionProjection().messages));
    expect(branched?.messages[0]).toEqual(first?.messages[0]);
    expect(JSON.stringify(branched?.messages[1])).toContain('BRANCH');
    expect(JSON.stringify(branched?.messages[1])).not.toContain('SECOND');
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
    const { runBeforeAgentStart, runContext, sessionManager } = registerHandlers(controller);

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
