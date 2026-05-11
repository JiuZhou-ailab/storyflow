// input: Workspace root and installed Method Pack contract
// output: Missing path/skill findings plus safe repair entrypoint
// pos: Consistency guard for project-level creative method environments

import { existsSync, statSync } from "fs";
import { join } from "path";
import { createNovelProjectScaffold } from "../novel-template.ts";
import type { MethodPack } from "./types.ts";

export interface MethodPackValidationFinding {
  severity: "error" | "warning";
  code: "missing_path" | "missing_skill";
  path: string;
}

function pathExists(rootPath: string, relativePath: string, kind: "file" | "directory"): boolean {
  const path = join(rootPath, relativePath);
  try {
    if (!existsSync(path)) return false;
    const stat = statSync(path);
    return kind === "file" ? stat.isFile() : stat.isDirectory();
  } catch {
    return false;
  }
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
    const skillPath = `skills/${skillSlug}/SKILL.md`;
    if (!pathExists(rootPath, skillPath, "file")) {
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
