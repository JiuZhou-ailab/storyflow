// input: A Pi Skill directory slug
// output: Browser-safe Storyflow default Skill identity
// pos: Shared product contract for Skills retained by bootstrap

export const DEFAULT_GLOBAL_AGENT_SKILL_SLUGS = [
  'find-skills',
  'firecrawl',
  'skill-creator',
  'storyflow-tutorial',
  'sn2s-novel-to-screenplay',
] as const;

export function isDefaultGlobalAgentSkillSlug(slug: string): boolean {
  return DEFAULT_GLOBAL_AGENT_SKILL_SLUGS.some(defaultSlug => defaultSlug === slug);
}
