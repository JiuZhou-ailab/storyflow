// input: optional agent working directory
// output: system prompt preset selected for that directory
// pos: adapter between workspace project metadata and agent prompt profiles

import { detectWritingProject } from "@craft-agent/shared/writing";
import type { SystemPromptPreset } from "../prompts/system.ts";

export function resolveSystemPromptPresetForWorkingDirectory(
  workingDirectory?: string
): SystemPromptPreset {
  if (!workingDirectory) {
    return "default";
  }

  return detectWritingProject(workingDirectory)?.type === "novel" ? "novel" : "default";
}
