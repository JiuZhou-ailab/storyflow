// input: writing project manifests and backend agent session configuration
// output: system prompt preset resolution behavior for full sessions
// pos: regression tests for automatic novel prompt profile selection

import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "@craft-agent/core/types";
import type { FileAttachment } from "../../utils/files.ts";
import { BaseAgent } from "../base-agent.ts";
import { resolveSystemPromptPresetForWorkingDirectory } from "../system-prompt-preset.ts";
import type { BackendConfig, ChatOptions } from "../backend/types.ts";
import { AbortReason } from "../backend/types.ts";
import type { LLMQueryRequest, LLMQueryResult } from "../llm-tool.ts";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "craft-agent-preset-"));
}

function createNovelProject(): string {
  const rootPath = createTempDir();
  writeFileSync(join(rootPath, "craft-writing.json"), JSON.stringify({
    schemaVersion: 1,
    type: "novel",
  }));
  return rootPath;
}

function createBackendConfig(overrides: Partial<BackendConfig> = {}): BackendConfig {
  const workspaceRoot = createTempDir();

  return {
    provider: "anthropic",
    workspace: {
      id: "workspace-1",
      name: "Workspace",
      slug: "workspace",
      rootPath: workspaceRoot,
      createdAt: 1,
    },
    model: "claude-test",
    isHeadless: true,
    skipConfigWatcher: true,
    ...overrides,
  };
}

class TestAgent extends BaseAgent {
  protected backendName = "Test";

  getResolvedPreset(): string | undefined {
    return this.config.systemPromptPreset;
  }

  protected async *chatImpl(
    _message: string,
    _attachments?: FileAttachment[],
    _options?: ChatOptions
  ): AsyncGenerator<AgentEvent> {
    yield { type: "complete" };
  }

  async abort(_reason?: string): Promise<void> {}

  forceAbort(_reason: AbortReason): void {}

  isProcessing(): boolean {
    return false;
  }

  respondToPermission(_requestId: string, _allowed: boolean, _alwaysAllow?: boolean): void {}

  async runMiniCompletion(_prompt: string): Promise<string | null> {
    return null;
  }

  async queryLlm(_request: LLMQueryRequest): Promise<LLMQueryResult> {
    return { text: "" };
  }
}

describe("resolveSystemPromptPresetForWorkingDirectory", () => {
  it("returns default when workingDirectory is omitted", () => {
    expect(resolveSystemPromptPresetForWorkingDirectory()).toBe("default");
  });

  it("returns novel for a novel writing project", () => {
    expect(resolveSystemPromptPresetForWorkingDirectory(createNovelProject())).toBe("novel");
  });

  it("returns default for a non-writing directory", () => {
    expect(resolveSystemPromptPresetForWorkingDirectory(createTempDir())).toBe("default");
  });
});

describe("BaseAgent system prompt preset resolution", () => {
  it("uses the novel preset for full sessions in novel working directories", () => {
    const agent = new TestAgent(
      createBackendConfig({
        session: {
          id: "session-1",
          workingDirectory: createNovelProject(),
        },
      }),
      "claude-test"
    );

    expect(agent.getResolvedPreset()).toBe("novel");
  });

  it("keeps explicit mini agent preset unchanged", () => {
    const agent = new TestAgent(
      createBackendConfig({
        session: {
          id: "session-1",
          workingDirectory: createNovelProject(),
        },
        systemPromptPreset: "mini",
      }),
      "claude-test"
    );

    expect(agent.getResolvedPreset()).toBe("mini");
  });
});
