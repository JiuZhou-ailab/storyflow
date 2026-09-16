// input: Managed connection generation, registered models, and awaited Pi lifecycle events.
// output: Session-local selection within Pi's existing retry budget; no replay or scheduler.
// pos: Trusted managed-model selection policy (ADR 0018); Pi owns execution and history.
import type {
  AgentSession,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  getSupportedThinkingLevels,
  type Model,
  type Api,
} from "@earendil-works/pi-ai";
import {
  isRetryableAssistantError,
  isContextOverflow,
} from "@earendil-works/pi-ai/compat";
import {
  MANAGED_FALLBACK_FAMILIES,
  MANAGED_MODEL_CATALOG,
} from "../../shared/src/config/managed-model-catalog.ts";
import type { PiInitMessage } from "../../shared/src/agent/backend/pi/protocol.ts";
import { setupI18n } from "../../shared/src/i18n/index.ts";

const FAILURE_THRESHOLD = 2;
const COOLDOWN_MS = 5 * 60_000;

export interface ManagedFallbackOptions {
  getSession(): AgentSession | null;
  getConfig(): PiInitMessage;
  fixedModel?: boolean;
  notify?(from: string, to: string): void;
  diagnostic?(data: Record<string, unknown>): void;
}

/** Create once per AgentSession; keep cooldown across Pi resource/Extension reloads. */
export function createManagedFallback(
  options: ManagedFallbackOptions,
): (pi: ExtensionAPI) => void {
  const health = new Map<string, { failures: number; until: number }>();
  let generation: PiInitMessage | undefined;
  let preferred: Model<Api> | undefined;
  let automatic: Model<Api> | undefined;
  let switched = false;
  let announced = false;
  let attempted = new Set<string>();
  let selectionRevision = 0;
  let rejectedResponse = false;
  let partial = false;

  const enabled = () => {
    const config = options.getConfig();
    if (config !== generation) {
      generation = config;
      health.clear();
      preferred = undefined;
      automatic = undefined;
      selectionRevision++;
    }
    return (
      !!config.managedConnection &&
      config.managedConnection.autoFallback !== false &&
      !options.fixedModel
    );
  };
  const key = (model: Model<Api>) =>
    `${model.provider}/${model.api}/${model.id}`;
  const cooling = (model: Model<Api>) =>
    (health.get(key(model))?.until ?? 0) > Date.now();

  const select = async (
    source: Model<Api>,
    ctx: ExtensionContext,
    bypass = false,
  ) => {
    const session = options.getSession();
    if (!session || !enabled() || session.model !== source) return;
    const declaration = (id: string) => {
      const model = options
        .getConfig()
        .customModels?.find(
          (model) => typeof model !== "string" && model.id === id,
        );
      return model && typeof model !== "string"
        ? model.fallbackCapabilities
        : undefined;
    };
    const sourceCapabilities = declaration(source.id);
    const family = MANAGED_FALLBACK_FAMILIES.find((ids) =>
      (ids as readonly string[]).includes(source.id),
    );
    const candidate = family
      ?.map((id) => session.modelRuntime.getModel(source.provider, id))
      .find((model) => {
        if (
          !model ||
          model.id === source.id ||
          attempted.has(model.id) ||
          cooling(model)
        )
          return false;
        const declared = MANAGED_MODEL_CATALOG.find(
          (item) => item.id === model.id,
        );
        const capabilities = declaration(model.id);
        // The custom-endpoint 8192 default is not evidence of an upstream capability.
        // JSON schemas currently travel as prompt instructions; native strict-schema mode is not implied.
        if (
          !sourceCapabilities ||
          !capabilities ||
          !Number.isFinite(sourceCapabilities.maxOutputTokens) ||
          sourceCapabilities.maxOutputTokens <= 0 ||
          !Number.isFinite(capabilities.maxOutputTokens) ||
          capabilities.maxOutputTokens < sourceCapabilities.maxOutputTokens ||
          source.maxTokens > sourceCapabilities.maxOutputTokens ||
          model.maxTokens > capabilities.maxOutputTokens ||
          (session.getActiveToolNames().length > 0 &&
            (!sourceCapabilities.tools || !capabilities.tools)) ||
          sourceCapabilities.structuredOutput !== "prompt" ||
          capabilities.structuredOutput !== "prompt"
        )
          return false;
        if (
          declared?.api !== source.api ||
          model.api !== source.api ||
          model.baseUrl !== source.baseUrl
        )
          return false;
        if (
          !Number.isFinite(source.contextWindow) ||
          !Number.isFinite(source.maxTokens) ||
          !Number.isFinite(model.contextWindow) ||
          !Number.isFinite(model.maxTokens) ||
          model.contextWindow < source.contextWindow ||
          model.maxTokens < source.maxTokens
        )
          return false;
        if (!source.input.every((input) => model.input.includes(input)))
          return false;
        // Preserve explicitly selected thinking capability; Pi still resolves native parameters.
        if (
          session.thinkingLevel !== "off" &&
          (!model.reasoning ||
            !getSupportedThinkingLevels(model).includes(session.thinkingLevel))
        )
          return false;
        return true;
      });
    if (!candidate) {
      options.diagnostic?.({
        event: "fallback_unavailable",
        model: source.id,
        reason: "no_compatible_candidate",
      });
      return;
    }
    const revision = selectionRevision;
    const config = options.getConfig();
    automatic = candidate;
    await session.setModel(candidate);
    if (
      revision !== selectionRevision ||
      options.getConfig() !== config ||
      session.model !== candidate ||
      ctx.signal?.aborted
    )
      return;
    switched = true;
    attempted.add(candidate.id);
    options.diagnostic?.({
      event: "model_fallback",
      requested_model: preferred?.id ?? source.id,
      effective_model: candidate.id,
      reason: bypass ? "cooldown" : "consecutive_failure",
    });
    if (!announced) {
      announced = true;
      // Native UI notification is projected by the existing Extension UI adapter.
      if (options.notify) options.notify(source.name, candidate.name);
      else
        ctx.ui.notify(
          setupI18n().t("chat.modelFallback", {
            from: source.name,
            to: candidate.name,
          }),
          "info",
        );
    }
  };

  return (pi) => {
    pi.on("model_select", (event) => {
      if (event.model === automatic) return;
      selectionRevision++;
      preferred = event.model;
      automatic = undefined;
      switched = true; // A manual selection wins for the rest of the operation.
    });
    pi.on("before_agent_start", async (_event, ctx) => {
      if (!enabled()) return;
      preferred = ctx.model;
      automatic = undefined;
      switched = false;
      announced = false;
      partial = false;
      attempted = new Set(ctx.model ? [ctx.model.id] : []);
      if (ctx.model && cooling(ctx.model)) await select(ctx.model, ctx, true);
    });
    pi.on("before_provider_headers", (_event, ctx) => {
      // A live config/credential replacement invalidates this operation, including retry waits.
      if (generation && options.getConfig() !== generation) ctx.abort();
      rejectedResponse = false;
    });
    pi.on("after_provider_response", (event) => {
      rejectedResponse =
        event.status === 401 ||
        event.status === 403 ||
        event.headers["x-should-retry"] === "false";
    });
    pi.on("message_update", (event) => {
      if (
        event.assistantMessageEvent.type.endsWith("_delta") ||
        event.assistantMessageEvent.type === "toolcall_start"
      )
        partial = true;
    });
    pi.on("message_end", (event) => {
      if (event.message.role !== "assistant") return;
      const message = event.message;
      const session = options.getSession();
      if (!enabled() || !session?.model) return;
      if (message.stopReason !== "error" && message.stopReason !== "aborted") {
        health.delete(key(session.model));
        partial = false;
        switched = false;
        attempted = new Set([session.model.id]);
      }
    });
    pi.on("agent_end", async (event, ctx) => {
      const session = options.getSession();
      if (!enabled() || !session || !ctx.model || ctx.signal?.aborted) return;
      const message = [...event.messages]
        .reverse()
        .find((message) => message.role === "assistant");
      if (
        !message ||
        message.role !== "assistant" ||
        rejectedResponse ||
        !isRetryableAssistantError(message) ||
        isContextOverflow(message, ctx.model.contextWindow)
      )
        return;
      if (
        !MANAGED_FALLBACK_FAMILIES.some((ids) =>
          (ids as readonly string[]).includes(ctx.model!.id),
        )
      )
        return;
      const previous = health.get(key(ctx.model));
      const failures = (previous?.failures ?? 0) + 1;
      health.set(key(ctx.model), {
        failures,
        until: failures >= FAILURE_THRESHOLD ? Date.now() + COOLDOWN_MS : 0,
      });
      const retry = session.settingsManager.getRetrySettings();
      if (
        failures < FAILURE_THRESHOLD ||
        switched ||
        partial ||
        message.content.length > 0 ||
        !session.autoRetryEnabled ||
        session.retryAttempt >= retry.maxRetries
      )
        return;
      await select(ctx.model, ctx);
    });
    pi.on("agent_settled", async () => {
      const session = options.getSession();
      if (
        !enabled() ||
        !session ||
        !preferred ||
        !automatic ||
        session.model !== automatic
      )
        return;
      automatic = preferred;
      await session.setModel(preferred);
      automatic = undefined;
    });
  };
}
