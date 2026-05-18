// input: Method Pack runtime metadata
// output: Agent-facing preamble text for a project method environment
// pos: Minimal adapter before Method Pack context is wired into agent prompt assembly

import type { MethodPack } from "./types.ts";

export function buildMethodPackRuntimePreamble(pack: MethodPack): string {
  return pack.runtimePreamble;
}

function formatOperatingRuleList(rules: string[]): string {
  return rules
    .map((rule) => `- ${rule}`)
    .join("\n");
}

function buildOperatingRulesContext(pack: MethodPack): string {
  if (!pack.operatingRules) {
    return "";
  }

  const alwaysRules = formatOperatingRuleList(pack.operatingRules.always);
  const periodicRules = formatOperatingRuleList(pack.operatingRules.periodic.rules);

  return `\n\n## Operating Rules
### Always
${alwaysRules}

### Periodic Reminder Policy
Interval: every ${pack.operatingRules.periodic.intervalTurns} user messages.
${periodicRules}`;
}

export function buildMethodPackPeriodicReminderContext(
  pack: MethodPack,
  userIteration: number | undefined,
): string {
  const periodic = pack.operatingRules?.periodic;
  if (!periodic || !userIteration || userIteration <= 1) {
    return "";
  }

  const interval = periodic.intervalTurns;
  if (!Number.isInteger(interval) || interval <= 0 || userIteration % interval !== 0) {
    return "";
  }

  return `<method_pack_periodic_reminder id="${pack.id}" iteration="${userIteration}" interval="${interval}" cadence="user messages">
${formatOperatingRuleList(periodic.rules)}
</method_pack_periodic_reminder>`;
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
  const operatingRules = buildOperatingRulesContext(pack);

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
${operatingRules}

## Skill Routing
${skillRouting}
</method_pack_runtime>`;
}
