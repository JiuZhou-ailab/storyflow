// input: Pi's public session, model and native settings
// output: Ephemeral product defaults without changing model capabilities or user preferences
// pos: Storyflow budget policy; Pi retains execution and compaction ownership
import type { AgentSession, SettingsManager, InlineExtension } from '@earendil-works/pi-coding-agent';

export function compactionDefaults(contextWindow: number | undefined) {
  if (!contextWindow || !Number.isSafeInteger(contextWindow) || contextWindow < 2) return {};
  const target = Math.floor(contextWindow * 0.8);
  return { reserveTokens: contextWindow - target, keepRecentTokens: Math.min(32000, Math.floor(target / 2)) };
}

export function applyCompactionDefaults(settings: SettingsManager, contextWindow?: number) {
  const explicit = { ...settings.getGlobalSettings().compaction, ...settings.getProjectSettings().compaction };
  settings.applyOverrides({ compaction: {
    enabled: true, reserveTokens: 16384, keepRecentTokens: 20000,
    ...compactionDefaults(contextWindow), maxSummaryTokens: 8192, ...explicit,
  } });
}

export function createBudgetHooks(getSession: () => AgentSession | null): InlineExtension {
  return { name: 'storyflow-budgets', factory(pi) {
    const refresh = () => {
      const session = getSession();
      if (session) applyCompactionDefaults(session.settingsManager, session.model?.contextWindow);
    };
    pi.on('before_agent_start', refresh);
    pi.on('model_select', refresh);
  } };
}

export function setOutputBudget(session: AgentSession, budget = 8192) {
  const stream = session.agent.streamFunction;
  session.agent.streamFunction = (model, input, options) => stream(model, input, {
    ...options, maxTokens: Math.min(budget, Number.isSafeInteger(model.maxTokens) && model.maxTokens > 0 ? model.maxTokens : 8192, options?.maxTokens ?? Infinity),
  });
}
