// input: Current Storyflow resource scope and a visible Skill slug
// output: Validation result for the owner-aware SKILL.md
// pos: Session-tool boundary for validating Pi-compatible Storyflow Skills

import { join } from 'node:path';
import type { SessionToolContext, SkillDocument } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';
import {
  validateSlug,
  validateSkillContent,
  formatValidationResult,
} from '../validation.ts';

export interface SkillValidateArgs {
  skillSlug: string;
  targetWorkspaceId?: string;
}

/**
 * Handle the skill_validate tool call.
 *
 * 1. Validate slug format
 * 2. Resolve SKILL.md from the active Storyflow resource overlay
 * 3. Read and validate content (frontmatter + body)
 * 4. Return the validation result
 */
export async function handleSkillValidate(
  ctx: SessionToolContext,
  args: SkillValidateArgs
): Promise<ToolResult> {
  const { skillSlug } = args;

  // Validate slug format first
  const slugResult = validateSlug(skillSlug);
  if (!slugResult.valid) {
    return {
      content: [{ type: 'text', text: formatValidationResult(slugResult) }],
      isError: true,
    };
  }

  let document: SkillDocument | null | undefined;
  try {
    document = ctx.loadSkillDocument?.(skillSlug, args.targetWorkspaceId);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Failed to resolve Skill');
  }
  const skillPath = document?.path
    ?? join(ctx.skillsPath, skillSlug, 'SKILL.md');
  if (!document && !ctx.fs.exists(skillPath)) {
    return errorResponse(
      `SKILL.md not found: ${skillPath}\n\nCreate it with skill_create before validating.`
    );
  }

  // Read and validate content
  let content = document?.content;
  try {
    content ??= ctx.fs.readFile(skillPath);
  } catch (e) {
    return errorResponse(
      `Cannot read file: ${e instanceof Error ? e.message : 'Unknown error'}`
    );
  }

  const result = validateSkillContent(content, skillSlug);
  const locationInfo = `Validated: ${skillPath}`;
  const formatted = formatValidationResult(result);

  return {
    content: [{ type: 'text', text: `${locationInfo}\n\n${formatted}` }],
    isError: !result.valid,
  };
}
