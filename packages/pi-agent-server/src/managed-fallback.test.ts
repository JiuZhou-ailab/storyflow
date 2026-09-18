// input: Real Pi sessions and loopback model HTTP fixtures.
// output: Spec #41 observable retry, fallback, history and side-effect contracts.
// pos: Integration acceptance at the approved Pi runtime boundary.
import { expect, test, spyOn } from "bun:test";
import type {
  AgentSession,
  InlineExtension,
} from "@earendil-works/pi-coding-agent";
import { createProviderHooks } from "./provider-hooks.ts";
import { normalizeUpstreamError } from "../../../apps/model-gateway-worker/src/upstream-error.ts";
import {
  fixture,
  completion,
  protocolCompletion,
} from "./managed-fallback.fixture.ts";

test("upstream auth denial terminates the real Pi session without retrying a mapped 502", async () => {
  await fixture(
    async ({ session, requests, events }) => {
      await session.prompt("test");
      await session.waitForIdle();
      expect(requests).toHaveLength(1);
      expect(events.filter((e) => e === "agent_settled")).toHaveLength(1);
    },
    () =>
      Response.json(
        {
          error: "Upstream access denied",
          code: "upstream_auth_failed",
          retryable: false,
        },
        { status: 502, headers: { "x-should-retry": "false" } },
      ),
  );
});

test("an upstream no-retry header survives gateway normalization and stops the real Pi session", async () => {
  await fixture(
    async ({ session, requests }) => {
      await session.prompt("do not retry");
      await session.waitForIdle();
      expect(requests).toHaveLength(1);
      expect(session.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "error" });
    },
    async () => (await normalizeUpstreamError(Response.json(
      { error: { message: "Do not retry", code: "server_error" } },
      { status: 503, headers: { "x-should-retry": "false" } },
    ))).response,
  );
});

test("two transient failures switch once within native retry budget and preserve one user message", async () => {
  await fixture(
    async ({ session, requests, events }) => {
      await session.prompt("test");
      await session.waitForIdle();
      expect(requests.map((r) => r.model)).toEqual([
        "deepseek-v4-flash",
        "deepseek-v4-flash",
        "deepseek-v4-pro",
      ]);
      expect(
        new Set(requests.map((r) => r.headers.get("x-storyflow-model-call-id")))
          .size,
      ).toBe(1);
      expect(requests.map((r) => r.headers.get("x-storyflow-attempt"))).toEqual(
        ["0", "1", "2"],
      );
      expect(session.getLastAssistantText()).toBe("OK");
      expect(session.messages.filter((m) => m.role === "user")).toHaveLength(1);
      expect(events.filter((e) => e === "agent_settled")).toHaveLength(1);
      expect(session.model?.id).toBe("deepseek-v4-flash");
      expect(session.settingsManager.getDefaultModel()).toBeUndefined();
    },
    (model, index) =>
      index < 3
        ? Response.json(
            { error: { message: "service unavailable" } },
            { status: 503 },
          )
        : completion(model),
  );
});

test("fallback failure consumes the remaining budget without a third model", async () => {
  await fixture(
    async ({ session, requests, events }) => {
      await session.prompt("test");
      await session.waitForIdle();
      expect(requests.map((r) => r.model)).toEqual([
        "deepseek-v4-flash",
        "deepseek-v4-flash",
        "deepseek-v4-pro",
        "deepseek-v4-pro",
      ]);
      expect(events.filter((e) => e === "agent_settled")).toHaveLength(1);
    },
    () =>
      Response.json(
        { error: { message: "service unavailable" } },
        { status: 503 },
      ),
  );
});

test("native retry respects Retry-After across a model switch", async () => {
  await fixture(
    async ({ session, requests }) => {
      await session.prompt("test");
      await session.waitForIdle();
      expect(requests).toHaveLength(3);
      expect(requests[2]!.at - requests[1]!.at).toBeGreaterThanOrEqual(195);
    },
    (model, index) =>
      index < 3
        ? Response.json(
            { error: { message: "service unavailable" } },
            { status: 503, headers: { "retry-after": "0.2" } },
          )
        : completion(model),
  );
});

test("cancellation during native backoff sends no new request", async () => {
  await fixture(
    async ({ session, requests, events }) => {
      session.subscribe((event) => {
        if (event.type === "auto_retry_start")
          setTimeout(() => void session.abort(), 5);
      });
      await session.prompt("test");
      await session.waitForIdle();
      expect(requests).toHaveLength(1);
      expect(events.filter((e) => e === "agent_settled")).toHaveLength(1);
    },
    () =>
      Response.json(
        { error: { message: "service unavailable" } },
        { status: 503, headers: { "retry-after": "10" } },
      ),
  );
});

for (const at of ["model_select", "auto_retry_start", "dispose"] as const)
  test(`cancellation inside ${at} prevents the next native request`, async () => {
    let active: AgentSession | undefined;
    await fixture(
      async ({ session, requests, events }) => {
        active = session;
        if (at === "auto_retry_start")
          session.subscribe((event) => {
            if (event.type === at) void session.abort();
          });
        await session.prompt("cancel at the selection boundary");
        await session.waitForIdle();
        expect(requests).toHaveLength(at === "auto_retry_start" ? 1 : 2);
        expect(session.isIdle).toBe(true);
        if (at !== "dispose")
          expect(
            events.filter((event) => event === "agent_settled"),
          ).toHaveLength(1);
      },
      () =>
        Response.json(
          { error: { message: "503 unavailable" } },
          { status: 503 },
        ),
      {
        name: "cancel-during-model-selection",
        factory(pi) {
          pi.on("model_select", (event) => {
            if (event.model.id !== "deepseek-v4-pro") return;
            if (at === "model_select") void active?.abort();
            if (at === "dispose") active?.dispose();
          });
        },
      },
    );
  });

for (const failures of [0, 1])
  test(`${failures} transient failures recover on the preferred model without a notice`, async () => {
    await fixture(
      async ({ session, requests, notices }) => {
        await session.prompt("test");
        await session.waitForIdle();
        expect(requests).toHaveLength(failures + 1);
        expect(requests.every((r) => r.model === "deepseek-v4-flash")).toBe(
          true,
        );
        expect(notices).toEqual([]);
      },
      (model, index) =>
        index <= failures
          ? Response.json(
              { error: { message: "503 unavailable" } },
              { status: 503 },
            )
          : completion(model),
    );
  });

for (const mode of [
  "disabled",
  "custom",
  "fixed",
  "candidateContext",
  "unknownCapabilities",
] as const)
  test(`${mode} excludes fallback without expanding native retries`, async () => {
    await fixture(
      async ({ session, requests, notices }) => {
        await session.prompt("test");
        await session.waitForIdle();
        expect(requests).toHaveLength(4);
        expect(new Set(requests.map((r) => r.model))).toEqual(
          new Set(["deepseek-v4-flash"]),
        );
        expect(notices).toEqual([]);
      },
      () =>
        Response.json(
          { error: { message: "503 unavailable" } },
          { status: 503 },
        ),
      undefined,
      mode === "candidateContext"
        ? { candidateContext: 1000 }
        : { [mode]: true },
    );
  });

test("exhausted budget does not switch until the next explicit operation; cooldown has no probes", async () => {
  await fixture(
    async ({ session, requests }) => {
      await session.prompt("first");
      await session.waitForIdle();
      expect(requests.map((r) => r.model)).toEqual([
        "deepseek-v4-flash",
        "deepseek-v4-flash",
      ]);
      await session.reload(); // The production Host reloads resources before each explicit prompt.
      await session.prompt("second");
      await session.waitForIdle();
      expect(requests.at(-1)?.model).toBe("deepseek-v4-pro");
      expect(requests.at(-1)?.headers.get("x-storyflow-requested-model")).toBe(
        "deepseek-v4-flash",
      );
      const clock = spyOn(Date, "now").mockReturnValue(Date.now() + 301_000);
      try {
        expect(requests).toHaveLength(3);
        await session.prompt("probe");
        await session.waitForIdle();
        expect(requests.at(-1)?.model).toBe("deepseek-v4-flash");
      } finally {
        clock.mockRestore();
      }
    },
    (model, index) =>
      index <= 2
        ? Response.json(
            { error: { message: "503 unavailable" } },
            { status: 503 },
          )
        : completion(model),
    undefined,
    { maxRetries: 1 },
  );
});

test("cancel during cooldown selection sends nothing and settles once", async () => {
  let active: AgentSession;
  await fixture(
    async ({ session, requests, events }) => {
      active = session;
      await session.prompt("cool down the preferred model");
      await session.waitForIdle();
      events.length = 0;
      await session.prompt("cancel before the initial fallback request");
      await session.waitForIdle();
      expect(requests).toHaveLength(2);
      expect(events.filter((event) => event === "agent_settled")).toHaveLength(
        1,
      );
    },
    () =>
      Response.json({ error: { message: "503 unavailable" } }, { status: 503 }),
    {
      name: "cancel-cooldown-selection",
      factory(pi) {
        pi.on("model_select", (event) => {
          if (event.model.id === "deepseek-v4-pro") void active.abort();
        });
      },
    },
    { maxRetries: 1 },
  );
});

test("config generation replacement during backoff cancels the old operation before HTTP", async () => {
  await fixture(
    async ({ session, requests, config, replaceConfig }) => {
      let replaced = false;
      session.subscribe((event) => {
        if (event.type === "auto_retry_start" && !replaced) {
          replaced = true;
          replaceConfig({
            ...config,
            managedConnection: {
              ...config.managedConnection!,
              autoFallback: false,
            },
          });
        }
      });
      await session.prompt("old generation");
      await session.waitForIdle();
      expect(requests).toHaveLength(1);
      await session.prompt("new generation");
      await session.waitForIdle();
      expect(requests).toHaveLength(2);
      expect(session.getLastAssistantText()).toBe("OK");
    },
    (model, index) =>
      index === 1
        ? Response.json(
            { error: { message: "503 unavailable" } },
            { status: 503 },
          )
        : completion(model),
  );
});

for (const partial of ["text", "reasoning", "tool", "empty"] as const)
  test(`${partial} incomplete stream never becomes success or crosses models after visible output`, async () => {
    await fixture(
      async ({ session, requests }) => {
        await session.prompt("test");
        await session.waitForIdle();
        expect(
          session.messages.filter((m) => m.role === "assistant").at(-1)
            ?.stopReason,
        ).toBe("error");
        if (partial !== "empty")
          expect(new Set(requests.map((r) => r.model))).toEqual(
            new Set(["deepseek-v4-flash"]),
          );
      },
      (model) => {
        const delta =
          partial === "text"
            ? { content: "partial" }
            : partial === "reasoning"
              ? { reasoning_content: "partial" }
              : partial === "tool"
                ? {
                    tool_calls: [
                      {
                        index: 0,
                        id: "incomplete",
                        type: "function",
                        function: { name: "effect", arguments: "{" },
                      },
                    ],
                  }
                : {};
        return new Response(
          `data: ${JSON.stringify({ id: "partial", model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    );
  });

for (const [api, models] of [
  ["openai-responses", ["gpt-5.6-luna", "gpt-5.6-sol"]],
  ["anthropic-messages", ["claude-sonnet-5", "claude-opus-5"]],
  ["google-generative-ai", ["gemini-3.8-flash", "gemini-3.7-flash"]],
] as const) {
  test(`${api} uses native protocol for same-family fallback`, async () => {
    await fixture(
      async ({ session, requests }) => {
        await session.prompt("test");
        await session.waitForIdle();
        expect(requests.map((r) => r.model)).toEqual([
          models[0],
          models[0],
          models[1],
        ]);
        expect(session.getLastAssistantText()).toBe("OK");
      },
      (model, index) =>
        index < 3
          ? Response.json(
              {
                error: {
                  message: "service unavailable",
                  code: 503,
                  status: "UNAVAILABLE",
                },
              },
              { status: 503 },
            )
          : protocolCompletion(api, model),
      undefined,
      { api, models: [...models] },
    );
  });
  test(`${api} treats structured permanent gateway failure as terminal`, async () => {
    await fixture(
      async ({ session, requests }) => {
        await session.prompt("test");
        await session.waitForIdle();
        expect(requests).toHaveLength(1);
      },
      () =>
        Response.json(
          {
            error: {
              message: "Upstream access denied",
              code: "upstream_auth_failed",
              retryable: false,
            },
          },
          { status: 502, headers: { "x-should-retry": "false" } },
        ),
      undefined,
      { api, models: [...models] },
    );
  });
}

test("a completed tool side effect is executed once and survives the failed continuation", async () => {
  const { Type } = await import("@sinclair/typebox");
  let effects = 0;
  await fixture(
    async ({ session, requests }) => {
      await session.prompt("test");
      await session.waitForIdle();
      expect(effects).toBe(1);
      expect(requests.map((r) => r.model)).toEqual([
        "deepseek-v4-flash",
        "deepseek-v4-flash",
        "deepseek-v4-flash",
        "deepseek-v4-pro",
      ]);
      expect(JSON.stringify(requests.at(-1)?.body)).toContain(
        "COMMITTED_EFFECT",
      );
      expect(requests[0]!.headers.get("x-storyflow-model-call-id")).not.toBe(
        requests[1]!.headers.get("x-storyflow-model-call-id"),
      );
      expect(
        new Set(
          requests
            .slice(1)
            .map((r) => r.headers.get("x-storyflow-model-call-id")),
        ).size,
      ).toBe(1);
    },
    (model, index) => {
      if (index === 1)
        return new Response(
          `data: ${JSON.stringify({ id: "tool", model, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "effect-1", type: "function", function: { name: "effect", arguments: "{}" } }] }, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        );
      return index < 4
        ? Response.json(
            { error: { message: "503 unavailable" } },
            { status: 503 },
          )
        : completion(model);
    },
    undefined,
    {
      tools: [
        {
          name: "effect",
          label: "Effect",
          description: "Commit once",
          parameters: Type.Object({}),
          async execute() {
            effects++;
            return {
              content: [{ type: "text", text: "COMMITTED_EFFECT" }],
              details: {},
            };
          },
        },
      ],
    },
  );
});

test("parallel sessions never share correlation IDs, counters, or selection", async () => {
  const ids: string[] = [];
  await Promise.all(
    [0, 1, 2].map((index) =>
      fixture(
        async ({ session, requests }) => {
          await session.prompt(`session ${index}`);
          await session.waitForIdle();
          expect(requests.map((r) => r.model)).toEqual(
            index === 0
              ? ["deepseek-v4-flash"]
              : ["deepseek-v4-flash", "deepseek-v4-flash", "deepseek-v4-pro"],
          );
          ids.push(requests[0]!.headers.get("x-storyflow-model-call-id")!);
          expect(requests[0]!.headers.get("x-storyflow-attempt")).toBe("0");
        },
        (model, attempt) =>
          index > 0 && attempt < 3
            ? Response.json(
                { error: { message: "503 unavailable" } },
                { status: 503 },
              )
            : completion(model),
      ),
    ),
  );
  expect(new Set(ids).size).toBe(3);
});

test("turning retry off never grants a fallback request in the current operation", async () => {
  await fixture(
    async ({ session, requests }) => {
      session.setAutoRetryEnabled(false);
      await session.prompt("one");
      await session.waitForIdle();
      await session.prompt("two");
      await session.waitForIdle();
      expect(requests.map((r) => r.model)).toEqual([
        "deepseek-v4-flash",
        "deepseek-v4-flash",
      ]);
      await session.prompt("three");
      await session.waitForIdle();
      expect(requests.at(-1)?.model).toBe("deepseek-v4-pro");
    },
    (model, index) =>
      index < 3
        ? Response.json(
            { error: { message: "503 unavailable" } },
            { status: 503 },
          )
        : completion(model),
  );
});

test("a manual choice made during automatic selection wins and is not restored away", async () => {
  let active: AgentSession;
  let once = false;
  const manual: InlineExtension = {
    name: "user-selection",
    factory(pi) {
      pi.on("model_select", async (event) => {
        if (event.model.id !== "deepseek-v4-pro" || once) return;
        once = true;
        await active.setModel(
          active.modelRuntime.getModel("fixture", "deepseek-v4-flash")!,
        );
      });
    },
  };
  await fixture(
    async ({ session, requests, notices }) => {
      active = session;
      await session.prompt("test");
      await session.waitForIdle();
      expect(new Set(requests.map((r) => r.model))).toEqual(
        new Set(["deepseek-v4-flash"]),
      );
      expect(session.model?.id).toBe("deepseek-v4-flash");
      expect(notices).toEqual([]);
    },
    (model, index) =>
      index < 3
        ? Response.json(
            { error: { message: "503 unavailable" } },
            { status: 503 },
          )
        : completion(model),
    manual,
  );
});

for (const retryAfter of ["2147484", "1000000000000000000"]) {
  test(`Google rejects Retry-After beyond the timer range: ${retryAfter}`, async () => {
    await fixture(
      async ({ session, requests }) => {
        let retryStarts = 0;
        session.subscribe((event) => {
          if (event.type === "auto_retry_start") retryStarts++;
        });
        await session.prompt("timer range");
        await session.waitForIdle();
        expect(requests).toHaveLength(1);
        expect(retryStarts).toBe(0);
        expect(session.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "error" });
      },
      async (model, index) => index === 1
        ? (await normalizeUpstreamError(Response.json(
            { error: { message: "503 unavailable" } },
            { status: 503, headers: { "retry-after": retryAfter } },
          ))).response
        : protocolCompletion("google-generative-ai", model),
      undefined,
      { api: "google-generative-ai", models: ["gemini-3.8-flash", "gemini-3.7-flash"], providerRetries: 1 },
    );
  });
}

test("Google native retry honors gateway Retry-After metadata when its SDK omits error headers", async () => {
  await fixture(
    async ({ session, requests }) => {
      await session.prompt("test");
      await session.waitForIdle();
      expect(requests).toHaveLength(2);
      expect(requests[1]!.at - requests[0]!.at).toBeGreaterThanOrEqual(195);
    },
    (model, index) =>
      index === 1
        ? Response.json(
            { error: { message: "503 unavailable", retry_after_ms: 200 } },
            { status: 503 },
          )
        : protocolCompletion("google-generative-ai", model),
    undefined,
    {
      api: "google-generative-ai",
      models: ["gemini-3.8-flash", "gemini-3.7-flash"],
    },
  );
});

for (const [api, models] of [
  ["openai-completions", ["deepseek-v4-flash", "deepseek-v4-pro"]],
  ["openai-responses", ["gpt-5.6-sol", "gpt-5.5"]],
  ["anthropic-messages", ["claude-sonnet-5", "claude-opus-5"]],
  ["google-generative-ai", ["gemini-3.8-flash", "gemini-3.7-flash"]],
] as const)
  test(`${api} never reports an empty HTTP 200 stream as completed`, async () => {
    await fixture(
      async ({ session, requests }) => {
        await session.prompt("empty stream");
        await session.waitForIdle();
        expect(requests).toHaveLength(1);
        expect(session.messages.at(-1)).toMatchObject({
          role: "assistant",
          stopReason: "error",
        });
      },
      () =>
        new Response("", { headers: { "content-type": "text/event-stream" } }),
      undefined,
      {
        api,
        models: [...models],
        maxRetries: 0,
      },
    );
  });

test("transport attempts count provider retries as well as session retries", async () => {
  await fixture(
    async ({ session, requests }) => {
      await session.prompt("test");
      await session.waitForIdle();
      expect(requests.map((r) => r.headers.get("x-storyflow-attempt"))).toEqual(
        ["0", "1", "2"],
      );
      expect(
        new Set(requests.map((r) => r.headers.get("x-storyflow-model-call-id")))
          .size,
      ).toBe(1);
    },
    (model, index) =>
      index < 3
        ? Response.json(
            { error: { message: "503 unavailable" } },
            { status: 503, headers: { "retry-after": "0" } },
          )
        : completion(model),
    undefined,
    { providerRetries: 2 },
  );
});

test("managed ephemeral queries bind the same extension and report the actual model", async () => {
  const { queryLlmWithEphemeralPiSession } =
    await import("./ephemeral-llm-query.ts");
  await fixture(
    async ({ session, requests, config, root }) => {
      const result = await queryLlmWithEphemeralPiSession(
        { prompt: "mini test" },
        {
          config: {
            ...config,
            miniModel: "deepseek-v4-flash",
            agentDir: root,
            piAuth: {
              provider: "fixture",
              credential: { type: "api_key", key: "local-fixture-only" },
            },
          },
          cwd: root,
          modelRuntime: session.modelRuntime,
          preferCustomEndpoint: false,
          debug() {},
        },
      );
      expect(requests.map((r) => r.model)).toEqual([
        "deepseek-v4-flash",
        "deepseek-v4-flash",
        "deepseek-v4-pro",
      ]);
      expect(result).toEqual({ text: "OK", model: "deepseek-v4-pro" });
      expect(session.messages).toHaveLength(0);
    },
    (model, index) =>
      index < 3
        ? Response.json(
            { error: { message: "503 unavailable" } },
            { status: 503 },
          )
        : completion(model),
  );
}, 15_000);

test("managed fixed mini-model rejection never enters the old model-not-found sending loop", async () => {
  const { queryLlmWithEphemeralPiSession } =
    await import("./ephemeral-llm-query.ts");
  await fixture(
    async ({ session, requests, config, root }) => {
      await expect(
        queryLlmWithEphemeralPiSession(
          { prompt: "mini test", model: "deepseek-v4-flash" },
          {
            config: {
              ...config,
              agentDir: root,
              piAuth: {
                provider: "fixture",
                credential: { type: "api_key", key: "local-fixture-only" },
              },
            },
            cwd: root,
            modelRuntime: session.modelRuntime,
            preferCustomEndpoint: false,
            debug() {},
          },
        ),
      ).rejects.toThrow("model_not_found");
      expect(requests).toHaveLength(1);
    },
    () =>
      Response.json({ error: { message: "model_not_found" } }, { status: 404 }),
  );
});

test("historical actual models survive the existing message storage codec", async () => {
  const { messageToStored, storedToMessage } =
    await import("../../core/src/types/message-mapper.ts");
  const message = {
    id: "fixture",
    role: "assistant" as const,
    content: "OK",
    model: "deepseek-v4-pro",
    timestamp: 1,
  };
  expect(
    storedToMessage(JSON.parse(JSON.stringify(messageToStored(message)))),
  ).toEqual(message);
  const { model: _, ...legacy } = message;
  expect(storedToMessage(messageToStored(legacy))).not.toHaveProperty("model");
});

test("two real subagent runs select independently while their parent stays on its model", async () => {
  const { createSubagentExtension } = await import("./subagent-tool.ts");
  const counts = new Map<string, number>();
  await fixture(
    async ({ session, requests }) => {
      await session.prompt("PARENT_RUN");
      await session.waitForIdle();
      expect(counts.get("parent")).toBe(2);
      expect(counts.get("child_a")).toBe(3);
      expect(counts.get("child_b")).toBe(3);
      expect(
        requests.filter((r) => r.model === "deepseek-v4-pro"),
      ).toHaveLength(2);
      expect(session.getLastAssistantText()).toBe("OK");
      expect(session.model?.id).toBe("deepseek-v4-flash");
    },
    (model, _index, body) => {
      const lastUser = (
        body.messages as Array<{ role: string; content: unknown }>
      )
        .filter((m) => m.role === "user")
        .at(-1);
      const content = JSON.stringify(lastUser?.content);
      const name = content.includes("Task: child_a")
        ? "child_a"
        : content.includes("Task: child_b")
          ? "child_b"
          : "parent";
      const count = (counts.get(name) ?? 0) + 1;
      counts.set(name, count);
      if (name === "parent" && count === 1) {
        const calls = ["child_a", "child_b"].map((task, index) => ({
          index,
          id: task,
          type: "function",
          function: {
            name: "subagent",
            arguments: JSON.stringify({ task, capability: "read_only" }),
          },
        }));
        return new Response(
          `data: ${JSON.stringify({ id: "parent-tools", model, choices: [{ index: 0, delta: { tool_calls: calls }, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        );
      }
      return name !== "parent" && count < 3
        ? Response.json(
            { error: { message: "503 unavailable" } },
            { status: 503 },
          )
        : completion(model);
    },
    undefined,
    {
      extraTools: ["subagent"],
      extensionFactory: (modelRuntime, config, root) =>
        createSubagentExtension({
          cwd: root,
          agentDir: root,
          modelRuntime,
          toolDefinitions: [],
          createSessionHooks: () => ({ name: "fixture-tools", factory() {} }),
          createProviderHooks: (getSession) =>
            createProviderHooks({
              enable1MContext: false,
              fallback: { getSession, getConfig: () => config },
            }),
        }),
    },
  );
}, 15_000);
