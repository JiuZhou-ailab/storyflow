// input: Method Pack runtime metadata
// output: Agent-facing preamble text for a project method environment
// pos: Minimal adapter before Method Pack context is wired into agent prompt assembly

import type { MethodPack } from "./types.ts";

export function buildMethodPackRuntimePreamble(pack: MethodPack): string {
  return pack.runtimePreamble;
}

export function buildMethodPackRuntimeContext(pack: MethodPack): string {
  const artifactContract = pack.artifactContract
    .map((artifact) => `- ${artifact.path} [${artifact.lifecycle}]: ${artifact.role}`)
    .join("\n");
  const skillRouting = pack.skillRouting
    .map((route) => `- ${route.when} -> ${route.skill}`)
    .join("\n");
  const namingConventions = pack.namingConventions?.length
    ? `\n\n## Naming Conventions\n${pack.namingConventions
        .map((rule) => `- ${rule.path}: ${rule.pattern} Example: ${rule.example}`)
        .join("\n")}`
    : "";

  return `<method_pack_runtime id="${pack.id}" version="${pack.version}">
## Agent Identity
${pack.agentIdentity}

## Always-On Instructions
${pack.alwaysOnInstructions}

## Initial Request Policy
${pack.initialRequestPolicy}

## Default Skill
${pack.defaultSkill}

## Artifact Contract
${artifactContract}
${namingConventions}

## Skill Routing
${skillRouting}
</method_pack_runtime>`;
}
