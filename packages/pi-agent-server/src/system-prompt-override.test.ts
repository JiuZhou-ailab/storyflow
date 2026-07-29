// input: Storyflow prompts, representative Skill metadata, and a fake Pi Extension API
// output: Regression assertions for Pi-native per-turn prompt injection
// pos: Contract test for the Storyflow-to-Pi prompt Extension

import { describe, expect, it } from 'bun:test';
import {
  createSyntheticSourceInfo,
  type BeforeAgentStartEvent,
  type BeforeAgentStartEventResult,
  type ExtensionAPI,
  type Skill,
} from '@earendil-works/pi-coding-agent';
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
  return () => handler!({} as BeforeAgentStartEvent, undefined as never);
}

describe('createSystemPromptOverride', () => {
  it('uses Pi before_agent_start and updates the next turn', async () => {
    const controller = createSystemPromptOverride();
    const run = registerHandler(controller);

    expect(await run()).toBeUndefined();
    controller.set('FIRST');
    expect(await run()).toEqual({ systemPrompt: 'FIRST' });
    controller.set('SECOND');
    expect(await run()).toEqual({ systemPrompt: 'SECOND' });
  });

  it('preserves Pi global Skill metadata for automatic invocation', async () => {
    const controller = createSystemPromptOverride();
    const run = registerHandler(controller);
    const skill: Skill = {
      name: 'outline-architecture',
      description: 'Design a story outline.',
      filePath: '/home/user/.craft-agent/skills/outline-architecture/SKILL.md',
      baseDir: '/home/user/.craft-agent/skills/outline-architecture',
      sourceInfo: createSyntheticSourceInfo(
        '/home/user/.craft-agent/skills/outline-architecture/SKILL.md',
        { source: 'storyflow-project', scope: 'project' },
      ),
      disableModelInvocation: false,
    };

    controller.set('CRAFT_PROMPT', [skill]);
    const result = await run();

    expect(result?.systemPrompt).toContain('CRAFT_PROMPT');
    expect(result?.systemPrompt).toContain('<name>outline-architecture</name>');
  });
});
