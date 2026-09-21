// input: One LLM query plus initialized Pi auth, model registry, and runtime configuration
// output: Exact text, integrity status, usage and effective budgets from a disposable Pi session
// pos: Ephemeral completion lifecycle used by call_llm and product mini-completions

import {
  createAgentSession,
  SessionManager as PiSessionManager,
  DefaultResourceLoader,
  SettingsManager,
  getAgentDir,
} from '@earendil-works/pi-coding-agent';
import type {
  AgentSession,
  AgentSessionEvent,
  CreateAgentSessionOptions,
  ModelRuntime,
} from '@earendil-works/pi-coding-agent';
import { Compile } from 'typebox/compile';
import { getDefaultSummarizationModel } from '../../shared/src/config/models.ts';
import { THINKING_TO_PI } from '../../shared/src/agent/backend/pi/constants.ts';
import type { PiInitMessage } from '../../shared/src/agent/backend/pi/protocol.ts';
import {
  LLM_QUERY_TIMEOUT_MS,
  withTimeout,
  type LLMQueryRequest,
  type LLMQueryResult,
} from '../../shared/src/agent/llm-tool.ts';
import { createProviderHooks } from './provider-hooks.ts';
import { createSystemPromptOverride } from './system-prompt-override.ts';
import { resolvePiModel, isDeniedMiniModelId, isModelNotFoundError } from './model-resolution.ts';
import { pickProviderAppropriateMiniModel } from './pick-mini-model.ts';

interface EphemeralLlmQueryContext {
  config: PiInitMessage;
  getConfig?(): PiInitMessage;
  isCancelled?(): boolean;
  activeSessions?: Set<AgentSession>;
  cwd: string;
  modelRuntime: ModelRuntime;
  preferCustomEndpoint: boolean;
  debug: (message: string) => void;
}

export async function queryLlmWithEphemeralPiSession(
  request: LLMQueryRequest,
  context: EphemeralLlmQueryContext,
): Promise<LLMQueryResult> {
  const { config, modelRuntime, preferCustomEndpoint, debug } = context;
  debug('[queryLlm] Starting');

  const piThinkingLevel = THINKING_TO_PI[
    request.thinkingLevel ?? 'medium'
  ];
  const requestedBudget = request.maxTokens ?? (request.longOutput ? 16384 : 8192);
  const timeoutMs = request.timeoutMs ?? (request.longOutput ? 300000 : LLM_QUERY_TIMEOUT_MS);
  if (!Number.isInteger(requestedBudget) || requestedBudget < 1 || requestedBudget > 32768) throw new Error('maxTokens must be between 1 and 32768');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw new Error('timeoutMs must be between 1 and 300000');
  if (!Object.hasOwn(THINKING_TO_PI, request.thinkingLevel ?? 'medium')) throw new Error('Invalid thinkingLevel');
  let model = request.model ?? config.miniModel ?? getDefaultSummarizationModel();
  const piAuthProvider = config.piAuth?.provider;

  if (config.piAuth) {
    const authProvider = config.piAuth.provider;
    const bareModel = model.startsWith('pi/') ? model.slice(3) : model;
    const resolved = resolvePiModel(modelRuntime, bareModel, authProvider, preferCustomEndpoint);
    const resolvedProvider = (resolved as { provider?: string } | undefined)?.provider;
    const isCompatible = resolvedProvider === authProvider || resolvedProvider === 'custom-endpoint';
    if (!resolved || !isCompatible || isDeniedMiniModelId(model, piAuthProvider)) {
      if (request.model) throw new Error(`Requested model is not available: ${request.model}`);
      const providerDefault = authProvider === 'anthropic'
        ? undefined
        : pickProviderAppropriateMiniModel(authProvider, modelRuntime, preferCustomEndpoint);
      const fallback = providerDefault ?? getDefaultSummarizationModel();
      debug(`[queryLlm] Model ${bareModel} incompatible with ${authProvider} (resolved: ${resolvedProvider}), falling back to ${fallback}`);
      model = fallback;
    }
  }

  const runQueryWithModel = async (modelId: string): Promise<LLMQueryResult> => {
    debug(`[queryLlm] Using model: ${modelId}`);
    const piModel = resolvePiModel(
      modelRuntime,
      modelId,
      config.piAuth?.provider,
      preferCustomEndpoint,
    );
    if (!piModel) {
      throw new Error(
        `Could not resolve mini model "${modelId}" for provider "${config.piAuth?.provider ?? '(unknown)'}"`,
      );
    }

    const settingsManager = SettingsManager.inMemory();
    const ephemeralOptions: CreateAgentSessionOptions = {
      cwd: context.cwd,
      modelRuntime,
      tools: [],
      sessionManager: PiSessionManager.inMemory(),
      settingsManager,
      model: piModel,
      ...(piThinkingLevel ? { thinkingLevel: piThinkingLevel } : {}),
    };
    const promptOverride = createSystemPromptOverride();
    promptOverride.set(request.systemPrompt ?? 'Reply with ONLY the requested text. No explanation.');
    let activeSession: AgentSession | null = null;
    const resourceLoader = new DefaultResourceLoader({
      cwd: context.cwd,
      agentDir: config.agentDir || getAgentDir(),
      settingsManager,
      extensionFactories: [
        promptOverride.extension,
        createProviderHooks({ enable1MContext: config.enable1MContext === true, fallback: { getSession: () => activeSession, getConfig: context.getConfig ?? (() => config), fixedModel: !!request.model, diagnostic: data => debug(JSON.stringify(data)) } }),
      ],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPromptOverride: promptOverride.overrideResourcePrompt,
    });
    await resourceLoader.reload();
    ephemeralOptions.resourceLoader = resourceLoader;

    const { session } = await createAgentSession(ephemeralOptions);
    const maxTokens = Math.min(requestedBudget, Number.isSafeInteger(piModel.maxTokens) && piModel.maxTokens > 0 ? piModel.maxTokens : 8192);
    let effectiveMaxTokens = maxTokens;
    let effectiveThinkingLevel = 'off';
    const stream = session.agent.streamFunction;
    session.agent.streamFunction = (model, input, options) => {
      effectiveMaxTokens = Math.min(maxTokens, Number.isSafeInteger(model.maxTokens) && model.maxTokens > 0 ? model.maxTokens : 8192);
      effectiveThinkingLevel = options?.reasoning ?? 'off';
      debug(`[queryLlm] model=${model.id} budget=${effectiveMaxTokens} thinking=${effectiveThinkingLevel} deadlineMs=${timeoutMs}`);
      return stream(model, input, { ...options, maxTokens: effectiveMaxTokens,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      });
    };
    try {
      activeSession = session;
      context.activeSessions?.add(session);
      await session.bindExtensions({});
      if (context.isCancelled?.()) return { text: '', status: 'cancelled', model: piModel.id, stopReason: 'aborted' };

      debug(`[queryLlm] Created ephemeral session: ${session.sessionId}`);
      let result = '';
      let effectiveModel = piModel.id;
      let lastError = '';
      let stopReason: string | undefined;
      let usage: { input?: number; output?: number } | undefined;
      const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
        if (event.type !== 'message_end') return;
        const message = event.message as {
          role?: string;
          model?: string;
          content?: string | Array<{ type: string; text?: string }>;
          stopReason?: string;
          usage?: { input?: number; output?: number };
          errorMessage?: string;
        };
        if (message.role !== 'assistant') return;
        effectiveModel = message.model ?? effectiveModel;
        stopReason = message.stopReason;
        usage = message.usage;
        lastError = message.stopReason === 'error' || message.stopReason === 'aborted' ? message.errorMessage ?? message.stopReason : '';
        if (message.stopReason === 'error' && message.errorMessage) {
          lastError = message.errorMessage;
          debug(`[queryLlm] API error in message_end: ${message.errorMessage}`);
        }
        if (typeof message.content === 'string') {
          result = message.content;
        } else if (Array.isArray(message.content)) {
          result = message.content
            .filter(content => content.type === 'text' && content.text)
            .map(content => content.text!)
            .join('');
        }
      });

      try {
        await withTimeout(
          (async () => { await session.prompt(request.prompt); await session.waitForIdle(); })(),
          timeoutMs,
          `queryLlm timed out after ${timeoutMs / 1000}s`,
        );
        debug(`[queryLlm] Result length: ${result.trim().length}`);
        if (lastError && !config.managedConnection && !request.model && isModelNotFoundError(lastError)) throw new Error(lastError);
        if (!lastError && stopReason !== 'length' && request.outputSchema) {
          try {
            const original = JSON.parse(result);
            if (!Compile(request.outputSchema).Check(original)) throw new Error('JSON schema validation failed');
          } catch (error) {
            lastError = `Output does not match the declared JSON schema: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
        const status = context.isCancelled?.() || stopReason === 'aborted' ? 'cancelled' : lastError ? 'failed'
          : stopReason === 'length' || !result.trim() ? 'incomplete' : 'completed';
        return { text: result, model: effectiveModel, status, stopReason, maxTokens: effectiveMaxTokens, thinkingLevel: effectiveThinkingLevel, timeoutMs,
          inputTokens: usage?.input, outputTokens: usage?.output,
          ...(status !== 'completed' ? { warning: lastError || 'Model output is incomplete.' } : {}),
        };
      } catch (error) {
        const warning = error instanceof Error ? error.message : String(error);
        if (!config.managedConnection && !request.model && isModelNotFoundError(warning)) throw error;
        return { text: result, model: effectiveModel, status: context.isCancelled?.() || warning.startsWith('queryLlm timed out') ? 'cancelled' : 'failed', stopReason: context.isCancelled?.() || warning.startsWith('queryLlm timed out') ? 'aborted' : 'error', warning,
          maxTokens: effectiveMaxTokens, thinkingLevel: effectiveThinkingLevel, timeoutMs, inputTokens: usage?.input, outputTokens: usage?.output };
      } finally {
        unsubscribe();
      }
    } finally {
      await session.abort();
      session.dispose();
      context.activeSessions?.delete(session);
    }
  };

  if (config.managedConnection || request.model) return runQueryWithModel(model);

  const fallbackCandidates = [
    'pi/gpt-5-mini',
    config.miniModel,
    getDefaultSummarizationModel(),
  ].filter((candidate): candidate is string => (
    !!candidate && !isDeniedMiniModelId(candidate, piAuthProvider)
  ));

  const triedModels = new Set<string>();
  let currentModel = model;
  while (true) {
    triedModels.add(currentModel);
    try {
      return await runQueryWithModel(currentModel);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isModelNotFoundError(message)) throw error;

      const retryModel = fallbackCandidates.find(candidate => {
        if (triedModels.has(candidate)) return false;
        const resolved = resolvePiModel(
          modelRuntime,
          candidate,
          config.piAuth?.provider,
          preferCustomEndpoint,
        );
        if (!resolved) return false;
        const provider = (resolved as { provider?: string }).provider;
        return !config.piAuth
          || provider === config.piAuth.provider
          || provider === 'custom-endpoint';
      });
      if (!retryModel) throw error;

      debug(`[queryLlm] Model ${currentModel} not found, retrying with ${retryModel}`);
      currentModel = retryModel;
    }
  }
}
