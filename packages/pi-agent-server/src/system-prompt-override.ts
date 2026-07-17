// input: Storyflow system prompt, Pi AgentSession, and project Skills metadata
// output: Stable per-turn system prompt that preserves Pi's progressive Skill disclosure
// pos: Compatibility bridge until Pi exposes a public per-turn system-prompt API

import {
  formatSkillsForPrompt,
  type AgentSession,
  type Skill,
} from '@earendil-works/pi-coding-agent';

/**
 * Force a system prompt onto a Pi AgentSession.
 *
 * Pi SDK has no public per-turn system-prompt API. Setting
 * `state.systemPrompt` directly is wiped on every `session.prompt()` call
 * (agent-session.js ~L796: `state.systemPrompt = _baseSystemPrompt`), and
 * `_baseSystemPrompt` itself can be regenerated from the SDK's resource loader
 * when tools change (`setActiveToolsByName`) or extensions reload.
 *
 * This stamps all three internals — `state.systemPrompt`, `_baseSystemPrompt`,
 * and `_rebuildSystemPrompt` — so our prompt survives every reset path.
 *
 * Pattern matches OpenClaw's `applySystemPromptOverrideToSession` (same SDK,
 * same constraint): https://github.com/openclaw/openclaw/blob/main/src/agents/pi-embedded-runner/system-prompt.ts
 *
 * Remove once the SDK exposes a public per-turn system-prompt API.
 */
export function applySystemPromptOverride(
  session: AgentSession,
  prompt: string,
  skills: Skill[] = [],
): void {
  const skillsPrompt = formatSkillsForPrompt(skills);
  const effectivePrompt = [prompt, skillsPrompt].filter(Boolean).join('\n\n');

  session.agent.state.systemPrompt = effectivePrompt;
  const mutable = session as unknown as {
    _baseSystemPrompt?: string;
    _rebuildSystemPrompt?: (toolNames: string[]) => string;
  };
  mutable._baseSystemPrompt = effectivePrompt;
  mutable._rebuildSystemPrompt = () => effectivePrompt;
}
