// input: Confirmed Skill slug and complete SKILL.md document
// output: One validated Skill created through the active Storyflow resource owner
// pos: Mutating session-tool boundary for conversational Skill creation

import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';
import {
  formatValidationResult,
  validateSlug,
  validateSkillContent,
} from '../validation.ts';

export interface SkillCreateArgs {
  skillSlug: string;
  content: string;
  targetWorkspaceId: string;
}

export async function handleSkillCreate(
  ctx: SessionToolContext,
  args: SkillCreateArgs,
): Promise<ToolResult> {
  const slugResult = validateSlug(args.skillSlug);
  if (!slugResult.valid) {
    return {
      content: [{ type: 'text', text: formatValidationResult(slugResult) }],
      isError: true,
    };
  }

  const contentResult = validateSkillContent(args.content, args.skillSlug);
  if (!contentResult.valid) {
    return {
      content: [{ type: 'text', text: formatValidationResult(contentResult) }],
      isError: true,
    };
  }

  if (!ctx.createSkillDocument) {
    return errorResponse('Skill creation is unavailable in this runtime.');
  }

  try {
    const created = await ctx.createSkillDocument(
      args.skillSlug,
      args.content,
      args.targetWorkspaceId,
    );
    return {
      content: [{
        type: 'text',
        text: `Created Skill: ${args.skillSlug}\nPath: ${created.path}\n\nRun skill_validate before reporting completion.`,
      }],
    };
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Failed to create Skill');
  }
}
