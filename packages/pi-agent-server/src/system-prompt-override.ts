// input: Storyflow system prompt and Pi Skill metadata
// output: Pi-native per-turn system prompt Extension
// pos: Public Extension boundary between Storyflow prompt assembly and Pi

import {
  formatSkillsForPrompt,
  type InlineExtension,
  type Skill,
} from '@earendil-works/pi-coding-agent';
import { fingerprint } from './prompt-cache-profile.ts';

export function createSystemPromptOverride(): {
  extension: InlineExtension;
  set(prompt: string, skills?: Skill[], dynamicPrompt?: string): {
    stablePrefixHash: string;
  };
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
    set(prompt, skills = [], dynamicPrompt) {
      const sortedSkills = [...skills].sort((a, b) => {
        if (a.name !== b.name) return a.name < b.name ? -1 : 1;
        return a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0;
      });
      const stablePrefix = [prompt, formatSkillsForPrompt(sortedSkills)]
        .filter(Boolean)
        .join('\n\n');
      systemPrompt = [stablePrefix, dynamicPrompt].filter(Boolean).join('\n\n');
      return { stablePrefixHash: fingerprint(stablePrefix) };
    },
  };
}
