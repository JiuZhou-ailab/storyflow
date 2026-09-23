// input: Real Pi sessions and a loopback HTTP provider (no paid model calls).
// output: Observable retry, fallback, history and cancellation contracts for spec #41.
// pos: Integration seam between trusted model selection and Pi-owned execution.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type InlineExtension,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { createProviderHooks } from "./provider-hooks.ts";
import type { ModelDefinition } from '../../shared/src/config/models.ts';
import { buildCustomEndpointModelDef } from './custom-endpoint-models.ts';
import { toPiCustomEndpointModelConfig } from '../../shared/src/agent/backend/pi/protocol.ts';

export function completion(model: string) {
  const chunk = (delta: object, finish_reason: string | null) => ({
    id: "fixture",
    object: "chat.completion.chunk",
    created: 1,
    model,
    choices: [{ index: 0, delta, finish_reason }],
  });
  return new Response(
    [chunk({ role: "assistant", content: "OK" }, null), chunk({}, "stop")]
      .map((value) => `data: ${JSON.stringify(value)}\n\n`)
      .join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );
}

type FixtureOptions = {
  catalog?: ModelDefinition[];
  extensionFactory?(
    runtime: ModelRuntime,
    config: import("../../shared/src/agent/backend/pi/protocol.ts").PiInitMessage,
    root: string,
  ): InlineExtension;
  extraTools?: string[];
  maxRetries?: number;
  providerRetries?: number;
  disabled?: boolean;
  custom?: boolean;
  fixed?: boolean;
  candidateContext?: number;
  unknownCapabilities?: boolean;
  tools?: ToolDefinition[];
  api?:
    | "openai-completions"
    | "openai-responses"
    | "anthropic-messages"
    | "google-generative-ai";
  models?: string[];
};

export async function fixture(
  run: (f: {
    session: AgentSession;
    requests: Array<{
      model: string;
      headers: Headers;
      at: number;
      body: Record<string, unknown>;
    }>;
    events: string[];
    notices: string[];
    root: string;
    config: import("../../shared/src/agent/backend/pi/protocol.ts").PiInitMessage;
    replaceConfig(
      config: import("../../shared/src/agent/backend/pi/protocol.ts").PiInitMessage,
    ): void;
  }) => Promise<void>,
  respond: (
    model: string,
    index: number,
    body: Record<string, unknown>,
    headers: Headers,
  ) => Response | Promise<Response>,
  extra?: InlineExtension,
  options: FixtureOptions = {},
) {
  const root = mkdtempSync(join(tmpdir(), "storyflow-fallback-"));
  const requests: Array<{
    model: string;
    headers: Headers;
    at: number;
    body: Record<string, unknown>;
  }> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as { model: string };
      body.model ??=
        /models\/([^:]+):/.exec(new URL(request.url).pathname)?.[1] ??
        "unknown";
      requests.push({
        model: body.model,
        headers: request.headers,
        at: Date.now(),
        body,
      });
      return respond(body.model, requests.length, body, request.headers);
    },
  });
  let session: AgentSession | undefined;
  try {
    const credentials = new InMemoryCredentialStore();
    await credentials.modify("fixture", async () => ({
      type: "api_key",
      key: "local-fixture-only",
    }));
    const modelRuntime = await ModelRuntime.create({
      credentials,
      modelsPath: null,
      refreshOnCreate: false,
    });
    const ids = options.models ?? ["deepseek-v4-flash", "deepseek-v4-pro"];
    modelRuntime.registerProvider("fixture", {
      api: options.api ?? "openai-completions",
      apiKey: "local-fixture-only",
      baseUrl: `http://127.0.0.1:${server.port}/v1`,
      models: ids.map((id, index) => ({
        id,
        name: id,
        reasoning: false,
        input: ["text"],
        contextWindow:
          index === 1 ? (options.candidateContext ?? 1_000_000) : 1_000_000,
        maxTokens: 8192,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        ...(options.catalog ? buildCustomEndpointModelDef(id, undefined, options.catalog.find(model => model.id === id)) : {}),
      })),
    });
    let config = {
      customModels: options.catalog?.map(toPiCustomEndpointModelConfig) ?? ids.map((id) => ({
        id,
        ...(options.unknownCapabilities
          ? {}
          : {
              fallbackCapabilities: {
                maxOutputTokens: 8192,
                tools: true,
                structuredOutput: "prompt" as const,
              },
            }),
      })),
      managedConnection: options.custom
        ? undefined
        : {
            slug: "storyflow-managed-deepseek",
            autoFallback: !options.disabled,
          },
    } as import("../../shared/src/agent/backend/pi/protocol.ts").PiInitMessage;
    const settingsManager = SettingsManager.inMemory({
      retry: {
        enabled: true,
        maxRetries: options.maxRetries ?? 3,
        baseDelayMs: 1,
        provider: { maxRetries: options.providerRetries ?? 0 },
      },
    });
    const notices: string[] = [];
    const extraExtension = options.extensionFactory?.(modelRuntime, config, root);
    const customTools = [...(options.tools ?? []), ...(extraExtension && typeof extraExtension === 'object' && 'tool' in extraExtension ? [extraExtension.tool as ToolDefinition] : [])];
    const resourceLoader = new DefaultResourceLoader({
      cwd: root,
      agentDir: root,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        createProviderHooks({
          enable1MContext: false,
          fallback: {
            getSession: () => session ?? null,
            getConfig: () => config,
            fixedModel: options.fixed,
            notify: (from, to) => notices.push(`${from}->${to}`),
          },
        }),
        ...(extra ? [extra] : []),
        ...(extraExtension ? [extraExtension] : []),
      ],
    });
    await resourceLoader.reload();
    ({ session } = await createAgentSession({
      cwd: root,
      modelRuntime,
      settingsManager,
      resourceLoader,
      model: modelRuntime.getModel("fixture", ids[0]!),
      customTools,
      tools: [
        ...customTools.map((t) => t.name),
        ...(options.extraTools ?? []),
      ],
      sessionManager: SessionManager.inMemory(root),
    }));
    await session.bindExtensions({});
    const events: string[] = [];
    session.subscribe((e) => events.push(e.type));
    await run({
      session,
      requests,
      events,
      notices,
      config,
      root,
      replaceConfig: (next) => {
        config = next;
      },
    });
  } finally {
    await session?.abort();
    session?.dispose();
    server.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
}

export function protocolCompletion(
  api: FixtureOptions["api"],
  model: string,
): Response {
  if (api === 'openai-completions') return completion(model);
  if (api === "google-generative-ai")
    return new Response(
      `data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "OK" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } })}\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    );
  const events =
    api === "anthropic-messages"
      ? [
          {
            type: "message_start",
            message: {
              id: "fixture",
              type: "message",
              role: "assistant",
              model,
              content: [],
              usage: { input_tokens: 1, output_tokens: 0 },
            },
          },
          {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "OK" },
          },
          { type: "content_block_stop", index: 0 },
          {
            type: "message_delta",
            delta: { stop_reason: "end_turn" },
            usage: { output_tokens: 1 },
          },
          { type: "message_stop" },
        ]
      : [
          {
            type: "response.created",
            response: { id: "fixture", status: "in_progress" },
          },
          {
            type: "response.output_item.added",
            output_index: 0,
            item: {
              type: "message",
              id: "msg",
              role: "assistant",
              content: [],
              status: "in_progress",
            },
          },
          {
            type: "response.content_part.added",
            item_id: "msg",
            output_index: 0,
            content_index: 0,
            part: { type: "output_text", text: "", annotations: [] },
          },
          {
            type: "response.output_text.delta",
            item_id: "msg",
            output_index: 0,
            content_index: 0,
            delta: "OK",
          },
          {
            type: "response.output_item.done",
            output_index: 0,
            item: {
              type: "message",
              id: "msg",
              role: "assistant",
              content: [{ type: "output_text", text: "OK", annotations: [] }],
              status: "completed",
            },
          },
          {
            type: "response.completed",
            response: {
              id: "fixture",
              status: "completed",
              model,
              output: [],
              usage: {
                input_tokens: 1,
                output_tokens: 1,
                total_tokens: 2,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens_details: { reasoning_tokens: 0 },
              },
            },
          },
        ];
  return new Response(
    events
      .map(
        (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      )
      .join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}
