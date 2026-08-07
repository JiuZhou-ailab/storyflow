// input: Storyflow product prompt, Pi-discovered prompt resources, and per-turn context
// output: ResourceLoader base-prompt policy and a dynamic-context Extension
// pos: Single composition boundary between Storyflow product policy and Pi prompt assembly

import {
  type InlineExtension,
} from '@earendil-works/pi-coding-agent';
import { fingerprint } from './prompt-cache-profile.ts';

export function buildEffectiveSystemPrompt(
  piSystemPrompt: string,
  dynamicPrompt?: string,
): string {
  return [piSystemPrompt, dynamicPrompt].filter(Boolean).join('\n\n');
}

export function createSystemPromptOverride(): {
  extension: InlineExtension;
  set(prompt: string, dynamicPrompt?: string): void;
  overrideResourcePrompt(discoveredPrompt: string | undefined): string | undefined;
  getStablePrefixHash(): string | null;
} {
  let productPrompt: string | undefined;
  let dynamicPrompt: string | undefined;
  let stablePrefixHash: string | null = null;

  return {
    extension: {
      name: 'storyflow-system-prompt',
      factory(pi) {
        pi.on('before_agent_start', (event) => {
          if (productPrompt === undefined) return undefined;

          // Pi has already appended its native context files, Skills, date, and cwd.
          // Keep that stable assembly intact and add only volatile product state.
          stablePrefixHash = fingerprint(event.systemPrompt);
          const systemPrompt = buildEffectiveSystemPrompt(event.systemPrompt, dynamicPrompt);
          return { systemPrompt };
        });
      },
    },
    set(prompt, nextDynamicPrompt) {
      productPrompt = prompt;
      dynamicPrompt = nextDynamicPrompt;
      stablePrefixHash = null;
    },
    overrideResourcePrompt(discoveredPrompt) {
      if (productPrompt === undefined) return discoveredPrompt;

      // Storyflow owns the product contract. A Pi-native SYSTEM.md remains an
      // additional user resource instead of replacing the product identity.
      return [productPrompt, discoveredPrompt]
        .filter(Boolean)
        .join('\n\n');
    },
    getStablePrefixHash() {
      return stablePrefixHash;
    },
  };
}
