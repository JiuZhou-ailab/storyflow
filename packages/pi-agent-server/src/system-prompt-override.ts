// input: Storyflow system prompt and Pi Skill metadata
// output: Pi-native per-turn system prompt Extension
// pos: Public Extension boundary between Storyflow prompt assembly and Pi

import {
  formatSkillsForPrompt,
  type InlineExtension,
  type Skill,
} from '@earendil-works/pi-coding-agent';

export function createSystemPromptOverride(): {
  extension: InlineExtension;
  set(prompt: string, skills?: Skill[]): void;
} {
  let systemPrompt: string | undefined;
  return {
    extension: {
      name: 'storyflow-system-prompt',
      factory(pi) {
        pi.on('before_agent_start', () => (
          systemPrompt === undefined ? undefined : { systemPrompt }
        ));
      },
    },
    set(prompt, skills = []) {
      systemPrompt = [prompt, formatSkillsForPrompt(skills)].filter(Boolean).join('\n\n');
    },
  };
}
