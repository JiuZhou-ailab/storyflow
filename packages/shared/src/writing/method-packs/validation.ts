// input: Workspace root and installed Method Pack contract
// output: Missing path/skill findings plus safe repair entrypoint
// pos: Consistency guard for project-level creative method environments

import { existsSync, statSync } from "fs";
import { join } from "path";
import { createNovelProjectScaffold } from "../novel-template.ts";
import type { MethodPack } from "./types.ts";
import {
  getExistingWorkspaceWritingManifestPath,
  getWorkspaceSkillsPath,
} from "../../workspaces/paths.ts";

export interface MethodPackValidationFinding {
  severity: "error" | "warning";
  code: "missing_path" | "missing_skill";
  path: string;
}

function pathExists(rootPath: string, relativePath: string, kind: "file" | "directory"): boolean {
  const path = relativePath === "craft-writing.json"
    ? getExistingWorkspaceWritingManifestPath(rootPath)
    : join(rootPath, relativePath);
  try {
    if (!existsSync(path)) return false;
    const stat = statSync(path);
    return kind === "file" ? stat.isFile() : stat.isDirectory();
  } catch {
    return false;
  }
}

function skillExists(rootPath: string, skillSlug: string): boolean {
  return pathExists(getWorkspaceSkillsPath(rootPath), `${skillSlug}/SKILL.md`, "file");
}

export function validateMethodPackInstall(
  rootPath: string,
  pack: MethodPack
): MethodPackValidationFinding[] {
  const findings: MethodPackValidationFinding[] = [];

  for (const requiredPath of pack.requiredPaths) {
    if (!pathExists(rootPath, requiredPath.path, requiredPath.kind)) {
      findings.push({
        severity: "error",
        code: "missing_path",
        path: requiredPath.path,
      });
    }
  }

  for (const skillSlug of pack.requiredSkills) {
    const skillPath = `.pi/skills/${skillSlug}/SKILL.md`;
    if (!skillExists(rootPath, skillSlug)) {
      findings.push({
        severity: "error",
        code: "missing_skill",
        path: skillPath,
      });
    }
  }

  return findings;
}

export function repairMethodPackInstall(
  rootPath: string,
  pack: MethodPack
): MethodPackValidationFinding[] {
  createNovelProjectScaffold(rootPath, { methodPackId: pack.id });

  return validateMethodPackInstall(rootPath, pack);
}
