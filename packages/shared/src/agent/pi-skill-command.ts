// input: User message, working directory, and Pi Skill catalog
// output: One native Pi Skill command plus resolved user content
// pos: Deterministic compatibility boundary from Storyflow mentions to Pi Skills

import { parseMentions, resolveSourceMentions, resolveFileMentions, WS_ID_CHARS } from '../mentions/index.ts';
import { loadPiSkillCatalog } from '../skills/pi-catalog.ts';

export interface PreparedPiSkillCommand {
  skillCommand: string | null;
  cleanMessage: string;
  missingSkills: string[];
  hasMultipleSkills: boolean;
}

export async function preparePiSkillCommand(
  message: string,
  workingDirectory: string,
  debug: (message: string) => void,
): Promise<PreparedPiSkillCommand> {
  if (!message.includes('[skill:')) {
    return {
      skillCommand: null,
      cleanMessage: resolveFileMentions(resolveSourceMentions(message), workingDirectory).trim(),
      missingSkills: [],
      hasMultipleSkills: false,
    };
  }

  const { skills } = await loadPiSkillCatalog(workingDirectory);
  const skillSlugs = skills.map(skill => skill.slug);
  debug(`[prepareSkillCommand] Available skills: ${skillSlugs.join(', ')}`);

  const parsed = parseMentions(message, skillSlugs, []);
  debug(`[prepareSkillCommand] Parsed skills: ${JSON.stringify(parsed.skills)}`);
  if (parsed.invalidSkills?.length) {
    debug(`[prepareSkillCommand] Invalid skills: ${JSON.stringify(parsed.invalidSkills)}`);
  }

  const selectedSlug = parsed.skills[0];
  const selected = selectedSlug ? skills.find(skill => skill.slug === selectedSlug) : undefined;
  const mentionPattern = new RegExp(`\\[skill:(?:${WS_ID_CHARS}+:)?([\\w-]+)\\]`, 'g');
  const onlySkillMention = message.replace(mentionPattern, '').trim().length === 0;
  const withoutSkillMention = onlySkillMention
    ? ''
    : message.replace(mentionPattern, (_match, slug: string, offset: number) => {
        if (message.slice(0, offset).trim().length === 0) return '';
        const skill = skills.find(item => item.slug === slug);
        return skill?.metadata.displayName ?? skill?.metadata.name ?? slug;
      }).trimStart();
  const cleanMessage = resolveFileMentions(
    resolveSourceMentions(withoutSkillMention),
    workingDirectory,
  ).trim();

  debug(`[prepareSkillCommand] Clean message: "${cleanMessage.slice(0, 100)}...", skill: ${selectedSlug ?? 'none'}`);
  return {
    skillCommand: selected ? `/skill:${selected.slug}` : null,
    cleanMessage,
    missingSkills: parsed.invalidSkills || [],
    hasMultipleSkills: parsed.skills.length > 1,
  };
}
