// input: Current Storyflow project root and a project Skill slug
// output: Validation result for the project's canonical SKILL.md
// pos: Session-tool boundary for validating Pi-compatible project Skills

import { join } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';
import {
  validateSlug,
  validateSkillContent,
  formatValidationResult,
} from '../validation.ts';

export interface SkillValidateArgs {
  skillSlug: string;
}

/**
 * Handle the skill_validate tool call.
 *
 * 1. Validate slug format
 * 2. Resolve SKILL.md from this Storyflow project only
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

  const skillPath = join(ctx.workspacePath, '.pi', 'skills', skillSlug, 'SKILL.md');
  if (!ctx.fs.exists(skillPath)) {
    return errorResponse(
      `SKILL.md not found: ${skillPath}\n\nCreate it under .pi/skills/ with YAML frontmatter.`
    );
  }

  // Read and validate content
  let content: string;
  try {
    content = ctx.fs.readFile(skillPath);
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
