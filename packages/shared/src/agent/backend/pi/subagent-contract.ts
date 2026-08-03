// input: Unknown Pi tool-result details crossing the agent-server event boundary
// output: Canonical Subagent Run result types and validated usage data
// pos: Shared contract between the Pi subagent Extension and Craft event projection

export const PI_SUBAGENT_DETAILS_KIND = 'storyflow-subagent' as const;

export interface PiSubagentUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  modelCalls?: number;
}

export interface PiSubagentTaskResult {
  task: string;
  capability: 'read_only' | 'workspace_write';
  status: 'completed' | 'failed';
  output: string;
  usage: PiSubagentUsage;
}

export interface PiSubagentDetails {
  kind: typeof PI_SUBAGENT_DETAILS_KIND;
  results: PiSubagentTaskResult[];
  usage: PiSubagentUsage;
}

export function isPiSubagentDetails(
  value: unknown,
): value is { kind: typeof PI_SUBAGENT_DETAILS_KIND; usage?: unknown } {
  return !!value
    && typeof value === 'object'
    && (value as { kind?: unknown }).kind === PI_SUBAGENT_DETAILS_KIND;
}

export function parsePiSubagentUsage(value: unknown): PiSubagentUsage | null {
  if (!isPiSubagentDetails(value)) return null;
  const usage = value.usage;
  if (!usage || typeof usage !== 'object') return null;

  const typed = usage as Partial<Record<keyof PiSubagentUsage, unknown>>;
  const fields: Array<keyof PiSubagentUsage> = [
    'input',
    'output',
    'cacheRead',
    'cacheWrite',
    'cost',
  ];
  if (!fields.every(field => (
    typeof typed[field] === 'number'
    && Number.isFinite(typed[field])
    && typed[field] >= 0
  ))) return null;

  if (
    typed.modelCalls !== undefined
    && (
      typeof typed.modelCalls !== 'number'
      || !Number.isInteger(typed.modelCalls)
      || typed.modelCalls < 0
    )
  ) return null;

  return typed as PiSubagentUsage;
}
