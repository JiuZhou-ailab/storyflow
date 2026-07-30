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

  it('keeps sorted Skills in the stable prefix and dynamic context at the tail', async () => {
    const controller = createSystemPromptOverride();
    const run = registerHandler(controller);
    const makeSkill = (name: string): Skill => ({
      name,
      description: `${name} instructions`,
      filePath: `/skills/${name}/SKILL.md`,
      baseDir: `/skills/${name}`,
      sourceInfo: createSyntheticSourceInfo(
        `/skills/${name}/SKILL.md`,
        { source: 'storyflow-project', scope: 'project' },
      ),
      disableModelInvocation: false,
    });
    const alpha = makeSkill('alpha');
    const zeta = makeSkill('zeta');

    const firstProfile = controller.set('STABLE', [zeta, alpha], 'DYNAMIC ONE');
    const firstPrompt = (await run())?.systemPrompt ?? '';
    const secondProfile = controller.set('STABLE', [alpha, zeta], 'DYNAMIC TWO');

    expect(firstPrompt.indexOf('<name>alpha</name>')).toBeLessThan(
      firstPrompt.indexOf('<name>zeta</name>'),
    );
    expect(firstPrompt.indexOf('<name>zeta</name>')).toBeLessThan(
      firstPrompt.indexOf('DYNAMIC ONE'),
    );
    expect(secondProfile.stablePrefixHash).toBe(firstProfile.stablePrefixHash);
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
