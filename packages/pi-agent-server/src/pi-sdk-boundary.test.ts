// input: pi-agent-server source files and the Pi SDK boundary whitelist below
// output: Failing test when a non-whitelisted Pi symbol or deep import enters the codebase
// pos: ADR 0018 boundary guard — keeps Storyflow on Pi's public contract surface only

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ADR 0018: Storyflow consumes Pi only through its promised contract surface.
 *
 * Adding a symbol here requires answering: "Is this a documented public export
 * with changelog guarantees, or a Pi implementation detail?" Implementation
 * details (internal classes, deep module paths) are forbidden — subclassing
 * Pi classes is also forbidden (compose, don't inherit).
 */
const ALLOWED_PI_VALUE_IMPORTS = new Set([
  "createAgentSession",
  "createWriteToolDefinition",
  "getAgentDir",
  "DefaultResourceLoader",
  "SessionManager",
  "SettingsManager",
]);

const ALLOWED_PI_TYPE_IMPORTS = new Set([
  "AgentSession",
  "AgentSessionEvent",
  "AgentToolResult",
  "ContextEvent",
  "CreateAgentSessionOptions",
  "ExtensionUIContext",
  "InlineExtension",
  "ModelRuntime",
  "ResourceLoader",
  "SessionEntry",
  "ToolCallEvent",
  "ToolDefinition",
  "ToolResultEvent",
  "WriteOperations",
]);

const PI_PACKAGE = "@earendil-works/pi-coding-agent";
const SOURCE_DIR = new URL(".", import.meta.url).pathname;

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(path));
      continue;
    }
    if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(path);
    }
  }
  return files;
}

function parseNamedImports(source: string): string[] {
  const symbols: string[] = [];
  const importPattern = new RegExp(
    `import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s+from\\s+["']${PI_PACKAGE}["']`,
    "g",
  );
  let match: RegExpExecArray | null;
  while ((match = importPattern.exec(source))) {
    const clause = match[1] ?? "";
    for (const raw of clause.split(",")) {
      const name = raw
        .replace(/\btype\b/, "")
        .trim()
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (name) symbols.push(name);
    }
  }
  return symbols;
}

describe("Pi SDK boundary (ADR 0018)", () => {
  const sourceFiles = collectSourceFiles(SOURCE_DIR);

  it("imports only whitelisted public Pi symbols", () => {
    const violations: string[] = [];
    for (const file of sourceFiles) {
      const source = readFileSync(file, "utf8");
      for (const symbol of parseNamedImports(source)) {
        if (
          !ALLOWED_PI_VALUE_IMPORTS.has(symbol) &&
          !ALLOWED_PI_TYPE_IMPORTS.has(symbol)
        ) {
          violations.push(`${file}: ${symbol}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("never deep-imports Pi internal module paths", () => {
    const deepImportPattern = new RegExp(
      `from\\s+["']${PI_PACKAGE}/[^"']+["']`,
    );
    const violations = sourceFiles.filter((file) =>
      deepImportPattern.test(readFileSync(file, "utf8")),
    );
    expect(violations).toEqual([]);
  });

  it("never subclasses Pi implementation classes", () => {
    const piClasses = [...ALLOWED_PI_VALUE_IMPORTS].filter((name) =>
      /^[A-Z]/.test(name),
    );
    const extendsPattern = new RegExp(`extends\\s+(${piClasses.join("|")})\\b`);
    const violations = sourceFiles.filter((file) =>
      extendsPattern.test(readFileSync(file, "utf8")),
    );
    expect(violations).toEqual([]);
  });
});
