// input: Creative project method pack metadata
// output: Shared Method Pack contracts for scaffold, validation, and agent context
// pos: Lightweight project-level creative environment definition

export type MethodPackId =
  | "novel.claude-book"
  | "novel.oh-story"
  | "novel.crucible"
  | "novel.creative-writing"
  | "short-form.article";
export type MethodPackProjectType = "novel" | "short-form";
export type MethodPackStorageProfile =
  | "claude-book-compatible"
  | "oh-story-compatible"
  | "crucible-compatible"
  | "creative-writing-compatible"
  | "short-form-compatible";

export interface MethodPackRequiredPath {
  path: string;
  kind: "file" | "directory";
}

export type MethodPackArtifactLifecycle =
  | "intake"
  | "reference"
  | "canon"
  | "outline"
  | "draft"
  | "final"
  | "review"
  | "state";

export interface MethodPackArtifactContract {
  path: string;
  role: string;
  lifecycle: MethodPackArtifactLifecycle;
}

export interface MethodPackSkillRouting {
  when: string;
  skill: string;
}

export interface MethodPackNamingConvention {
  path: string;
  pattern: string;
  example: string;
}

export interface MethodPack {
  id: MethodPackId;
  version: 1;
  displayName: string;
  projectType: MethodPackProjectType;
  storageProfile: MethodPackStorageProfile;
  source: {
    name: string;
    url: string;
    license: string;
    inspectedCommit: string;
  };
  requiredPaths: MethodPackRequiredPath[];
  requiredSkills: string[];
  runtimePreamble: string;
  starterMessage: string;
  agentIdentity: string;
  defaultSkill: string;
  alwaysOnInstructions: string;
  initialRequestPolicy: string;
  artifactContract: MethodPackArtifactContract[];
  namingConventions?: MethodPackNamingConvention[];
  skillRouting: MethodPackSkillRouting[];
}
