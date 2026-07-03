// input: Electron main log text containing rendererPerf and shared perf lines
// output: Aggregated operation latency summaries and slow-event listings
// pos: Local QA helper for turning debug performance logs into actionable evidence

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs as parseNodeArgs } from "node:util";

export interface ElectronPerfMetric {
  name: string;
  durationMs: number;
  lineNumber: number;
  source: "shared-perf" | "renderer-writing" | "renderer-session" | "renderer-text-delta";
  kind: "latency" | "throughput-window";
  metadata?: Record<string, unknown>;
}

export interface PerfOperationSummary {
  name: string;
  count: number;
  totalMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface ElectronSearchActivitySummary {
  batchCallCount: number;
  batchQueryErrorCount: number;
  listFileCallCount: number;
  singleCallCount: number;
  singleReturnCount: number;
  totalBatchRequestCount: number;
  totalListRootCount: number;
  totalSingleResultCount: number;
  basePathCount: number;
  busiestBasePaths: Array<{ basePath: string; count: number }>;
}

export interface ElectronPerfSummary {
  metrics: ElectronPerfMetric[];
  latencyMetrics: ElectronPerfMetric[];
  throughputWindows: ElectronPerfMetric[];
  operations: PerfOperationSummary[];
  slowest: ElectronPerfMetric[];
  searchActivity: ElectronSearchActivitySummary;
}

interface CliOptions {
  logPath: string;
  json: boolean;
  limit: number;
  requireMainSpans: boolean;
  since?: Date;
  slowThresholdMs: number;
}

const DEFAULT_SLOW_THRESHOLD_MS = 250;
const DEFAULT_SLOW_LIMIT = 10;

function defaultElectronLogPath(): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Logs", "@craft-agent", "electron", "main.log");
  }

  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? homedir(), "@craft-agent", "electron", "logs", "main.log");
  }

  return join(homedir(), ".config", "@craft-agent", "electron", "logs", "main.log");
}

function parseMetadata(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function extractLogMessage(line: string): string {
  const message = extractLogMessageData(line);
  if (typeof message === "string") return message;
  if (Array.isArray(message)) {
    const firstString = message.find((entry): entry is string => typeof entry === "string");
    if (firstString) return firstString;
  }

  return line;
}

function extractLogMessageData(line: string): string | unknown[] {
  if (!line.startsWith("{")) return line;

  try {
    const parsed = JSON.parse(line) as { message?: unknown };
    const message = parsed.message;
    if (typeof message === "string") return message;
    if (Array.isArray(message)) return message;
  } catch {
    return line;
  }

  return line;
}

function parseLogTimestamp(line: string): Date | null {
  if (line.startsWith("{")) {
    try {
      const parsed = JSON.parse(line) as { timestamp?: unknown };
      if (typeof parsed.timestamp === "string") {
        const timestamp = new Date(parsed.timestamp);
        return Number.isNaN(timestamp.getTime()) ? null : timestamp;
      }
    } catch {
      return null;
    }
  }

  const isoPrefix = line.match(/^(\d{4}-\d{2}-\d{2}T[^\s]+)/);
  if (isoPrefix) {
    const timestamp = new Date(isoPrefix[1]);
    return Number.isNaN(timestamp.getTime()) ? null : timestamp;
  }

  const localPrefix = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
  if (localPrefix) {
    const timestamp = new Date(localPrefix[1].replace(" ", "T"));
    return Number.isNaN(timestamp.getTime()) ? null : timestamp;
  }

  return null;
}

export function filterElectronLogTextSince(logText: string, since: Date): string {
  const sinceTime = since.getTime();
  if (Number.isNaN(sinceTime)) return logText;

  return logText
    .split(/\r?\n/)
    .filter((line) => {
      const timestamp = parseLogTimestamp(line);
      return timestamp != null && timestamp.getTime() >= sinceTime;
    })
    .join("\n");
}

export function parseElectronPerfMetrics(logText: string): ElectronPerfMetric[] {
  const metrics: ElectronPerfMetric[] = [];
  const lines = logText.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = extractLogMessage(lines[index] ?? "");
    const lineNumber = index + 1;

    const sharedPerf = line.match(/\[PERF\]\s+([^:]+):\s+([0-9]+(?:\.[0-9]+)?)ms(?:\s+\([^)]*\))?(?:\s+(\{.*\}))?/);
    if (sharedPerf) {
      metrics.push({
        name: sharedPerf[1].trim(),
        durationMs: Number(sharedPerf[2]),
        lineNumber,
        source: "shared-perf",
        kind: "latency",
        metadata: parseMetadata(sharedPerf[3]),
      });
      continue;
    }

    const writing = line.match(/\bwriting\.document\.([A-Za-z0-9_.-]+):\s+([0-9]+(?:\.[0-9]+)?)ms(?:,\s*chars=([0-9]+))?(?:,\s*file=(.+))?/);
    if (writing) {
      const metadata: Record<string, unknown> = {};
      if (writing[3]) metadata.chars = Number(writing[3]);
      if (writing[4]) metadata.file = writing[4].trim();

      metrics.push({
        name: `writing.document.${writing[1]}`,
        durationMs: Number(writing[2]),
        lineNumber,
        source: "renderer-writing",
        kind: "latency",
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      });
      continue;
    }

    const sessionSwitch = line.match(/\bSession switch complete:\s+([0-9]+(?:\.[0-9]+)?)ms/);
    if (sessionSwitch) {
      metrics.push({
        name: "renderer.sessionSwitch",
        durationMs: Number(sessionSwitch[1]),
        lineNumber,
        source: "renderer-session",
        kind: "latency",
      });
      continue;
    }

    const textDelta = line.match(/\btext_delta\.window:\s+([0-9]+)\s+events,\s+([0-9]+)\s+chars,\s+([0-9]+(?:\.[0-9]+)?)ms/);
    if (textDelta) {
      metrics.push({
        name: "renderer.textDeltaWindow",
        durationMs: Number(textDelta[3]),
        lineNumber,
        source: "renderer-text-delta",
        kind: "throughput-window",
        metadata: {
          events: Number(textDelta[1]),
          chars: Number(textDelta[2]),
        },
      });
    }
  }

  return metrics;
}

export function summarizeElectronSearchActivity(logText: string): ElectronSearchActivitySummary {
  let batchCallCount = 0;
  let batchQueryErrorCount = 0;
  let listFileCallCount = 0;
  let singleCallCount = 0;
  let singleReturnCount = 0;
  let totalBatchRequestCount = 0;
  let totalListRootCount = 0;
  let totalSingleResultCount = 0;
  const basePathCounts = new Map<string, number>();

  for (const line of logText.split(/\r?\n/)) {
    const message = extractLogMessageData(line);
    if (!Array.isArray(message)) continue;

    const [event, basePathOrCount, maybeCount] = message;
    if (event === "[FS_SEARCH_BATCH] called:") {
      batchCallCount += 1;
      if (typeof maybeCount === "number") totalBatchRequestCount += maybeCount;
      if (typeof basePathOrCount === "string") {
        basePathCounts.set(basePathOrCount, (basePathCounts.get(basePathOrCount) ?? 0) + 1);
      }
      continue;
    }

    if (event === "[FS_LIST_FILES] called:") {
      listFileCallCount += 1;
      if (typeof maybeCount === "number") totalListRootCount += maybeCount;
      if (typeof basePathOrCount === "string") {
        basePathCounts.set(basePathOrCount, (basePathCounts.get(basePathOrCount) ?? 0) + 1);
      }
      continue;
    }

    if (event === "[FS_SEARCH_BATCH] query error:") {
      batchQueryErrorCount += 1;
      continue;
    }

    if (event === "[FS_SEARCH] called:") {
      singleCallCount += 1;
      if (typeof basePathOrCount === "string") {
        basePathCounts.set(basePathOrCount, (basePathCounts.get(basePathOrCount) ?? 0) + 1);
      }
      continue;
    }

    if (event === "[FS_SEARCH] returning") {
      singleReturnCount += 1;
      if (typeof basePathOrCount === "number") totalSingleResultCount += basePathOrCount;
    }
  }

  const busiestBasePaths = Array.from(basePathCounts, ([basePath, count]) => ({ basePath, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    batchCallCount,
    batchQueryErrorCount,
    listFileCallCount,
    singleCallCount,
    singleReturnCount,
    totalBatchRequestCount,
    totalListRootCount,
    totalSingleResultCount,
    basePathCount: basePathCounts.size,
    busiestBasePaths,
  };
}

function percentile(sorted: number[], percentileValue: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)
  );
  return sorted[index] ?? 0;
}

export function summarizeElectronPerfMetrics(
  metrics: ElectronPerfMetric[],
  options: { slowThresholdMs?: number; limit?: number; searchActivity?: ElectronSearchActivitySummary } = {}
): ElectronPerfSummary {
  const latencyMetrics = metrics.filter(metric => metric.kind === "latency");
  const throughputWindows = metrics.filter(metric => metric.kind === "throughput-window");
  const byName = new Map<string, number[]>();
  for (const metric of latencyMetrics) {
    const durations = byName.get(metric.name) ?? [];
    durations.push(metric.durationMs);
    byName.set(metric.name, durations);
  }

  const operations = Array.from(byName, ([name, durations]) => {
    const sorted = [...durations].sort((a, b) => a - b);
    const totalMs = durations.reduce((sum, value) => sum + value, 0);

    return {
      name,
      count: durations.length,
      totalMs,
      avgMs: totalMs / durations.length,
      p50Ms: percentile(sorted, 0.5),
      p95Ms: percentile(sorted, 0.95),
      maxMs: sorted[sorted.length - 1] ?? 0,
    };
  }).sort((a, b) => b.totalMs - a.totalMs);

  const slowThresholdMs = options.slowThresholdMs ?? DEFAULT_SLOW_THRESHOLD_MS;
  const limit = options.limit ?? DEFAULT_SLOW_LIMIT;
  const slowest = latencyMetrics
    .filter(metric => metric.durationMs >= slowThresholdMs)
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, limit);

  return {
    metrics,
    latencyMetrics,
    throughputWindows,
    operations,
    slowest,
    searchActivity: options.searchActivity ?? summarizeElectronSearchActivity(""),
  };
}

function formatMs(value: number): string {
  return `${value.toFixed(1)}ms`;
}

export function getElectronInstrumentationGaps(summary: ElectronPerfSummary): string[] {
  const operationNames = new Set(summary.operations.map(operation => operation.name));
  const hasRendererReadMetrics = operationNames.has("writing.document.readFile")
    || operationNames.has("writing.document.readFile.error");
  const hasFileReadRpcMetrics = operationNames.has("rpc.file.read");
  const hasSearchBatchPerfMetrics = operationNames.has("fs.searchBatch");
  const hasListFilesPerfMetrics = operationNames.has("fs.listFiles");
  const hasRawSearchBatchLogs = summary.searchActivity.batchCallCount > 0;
  const hasRawListFilesLogs = summary.searchActivity.listFileCallCount > 0;
  const gaps: string[] = [];

  if (hasRendererReadMetrics && !hasFileReadRpcMetrics) {
    gaps.push("`writing.document.readFile` is present but `rpc.file.read` is absent; restart Electron after main-process changes before judging server-side read latency.");
  }
  if (hasRawSearchBatchLogs && !hasSearchBatchPerfMetrics) {
    gaps.push("Raw `[FS_SEARCH_BATCH]` logs are present but `fs.searchBatch` spans are absent; restart Electron to load batch-search perf metadata.");
  }
  if (hasRawListFilesLogs && !hasListFilesPerfMetrics) {
    gaps.push("Raw `[FS_LIST_FILES]` logs are present but `fs.listFiles` spans are absent; restart Electron to load workspace-list perf metadata.");
  }

  return gaps;
}

export function formatElectronPerfSummary(
  summary: ElectronPerfSummary,
  logPath: string,
  options: { since?: Date } = {}
): string {
  const lines: string[] = [];
  lines.push("Electron Performance Summary");
  lines.push(`Log: ${logPath}`);
  if (options.since) {
    lines.push(`Since: ${options.since.toISOString()}`);
  }
  lines.push(`Metrics: ${summary.metrics.length} (${summary.latencyMetrics.length} latency, ${summary.throughputWindows.length} throughput windows)`);

  const instrumentationGaps = getElectronInstrumentationGaps(summary);
  if (instrumentationGaps.length > 0) {
    lines.push("");
    lines.push("Instrumentation Notes");
    for (const gap of instrumentationGaps) {
      lines.push(`- ${gap}`);
    }
  }

  if (summary.operations.length === 0) {
    lines.push("No performance metrics found.");
    return lines.join("\n");
  }

  lines.push("");
  lines.push("| Operation | Count | Avg | P50 | P95 | Max | Total |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const operation of summary.operations) {
    lines.push([
      `| ${operation.name}`,
      operation.count,
      formatMs(operation.avgMs),
      formatMs(operation.p50Ms),
      formatMs(operation.p95Ms),
      formatMs(operation.maxMs),
      `${formatMs(operation.totalMs)} |`,
    ].join(" | "));
  }

  lines.push("");
  lines.push("Slowest Events");
  if (summary.slowest.length === 0) {
    lines.push("No events crossed the slow threshold.");
  } else {
    for (const metric of summary.slowest) {
      const meta = metric.metadata ? ` ${JSON.stringify(metric.metadata)}` : "";
      lines.push(`- ${formatMs(metric.durationMs)} ${metric.name} line=${metric.lineNumber}${meta}`);
    }
  }

  if (summary.throughputWindows.length > 0) {
    const totals = summary.throughputWindows.reduce((acc, metric) => {
      acc.events += typeof metric.metadata?.events === "number" ? metric.metadata.events : 0;
      acc.chars += typeof metric.metadata?.chars === "number" ? metric.metadata.chars : 0;
      acc.windowMs += metric.durationMs;
      return acc;
    }, { events: 0, chars: 0, windowMs: 0 });

    lines.push("");
    lines.push("Throughput Windows");
    lines.push(`- renderer.textDeltaWindow: ${summary.throughputWindows.length} windows, ${totals.events} events, ${totals.chars} chars, avg window ${formatMs(totals.windowMs / summary.throughputWindows.length)}`);
  }

  const search = summary.searchActivity;
  if (search.batchCallCount > 0 || search.listFileCallCount > 0 || search.singleCallCount > 0) {
    lines.push("");
    lines.push("Filesystem Search Activity");
    lines.push(`- batch calls: ${search.batchCallCount}, total batch requests: ${search.totalBatchRequestCount}, query errors: ${search.batchQueryErrorCount}`);
    lines.push(`- list calls: ${search.listFileCallCount}, total listed roots: ${search.totalListRootCount}`);
    lines.push(`- single calls: ${search.singleCallCount}, returns: ${search.singleReturnCount}, total returned results: ${search.totalSingleResultCount}`);
    if (search.busiestBasePaths.length > 0) {
      lines.push("- busiest roots:");
      for (const item of search.busiestBasePaths) {
        lines.push(`  - ${item.count} ${item.basePath}`);
      }
    }
  }

  return lines.join("\n");
}

function parseArgs(argv: string[]): CliOptions {
  const parsed = parseNodeArgs({
    args: argv,
    allowPositionals: false,
    options: {
      help: { type: "boolean", short: "h" },
      json: { type: "boolean" },
      limit: { type: "string" },
      log: { type: "string" },
      "last-minutes": { type: "string" },
      "require-main-spans": { type: "boolean" },
      since: { type: "string" },
      slow: { type: "string" },
    },
  });

  if (parsed.values.help) {
    console.log([
      "Usage: bun run scripts/electron-perf-summary.ts [options]",
      "",
      "Options:",
      "  --log <path>    Electron main.log path",
      "  --slow <ms>     Slow-event threshold, default 250",
      "  --limit <n>     Slow-event limit, default 10",
      "  --since <iso>   Only include log lines at or after this timestamp",
      "  --last-minutes <n>  Only include log lines from the last n minutes",
      "  --require-main-spans  Exit non-zero when paired main-process spans are missing",
      "  --json          Emit JSON",
    ].join("\n"));
    process.exit(0);
  }

  const options: CliOptions = {
    logPath: defaultElectronLogPath(),
    json: parsed.values.json ?? false,
    limit: DEFAULT_SLOW_LIMIT,
    requireMainSpans: parsed.values["require-main-spans"] ?? false,
    slowThresholdMs: DEFAULT_SLOW_THRESHOLD_MS,
  };

  if (parsed.values.log) {
    options.logPath = parsed.values.log;
  }
  if (parsed.values.limit) {
    const value = Number(parsed.values.limit);
    if (!Number.isFinite(value) || value < 1) throw new Error("--limit requires a positive number");
    options.limit = Math.floor(value);
  }
  if (parsed.values.since) {
    const timestamp = new Date(parsed.values.since);
    if (Number.isNaN(timestamp.getTime())) throw new Error("--since requires a valid timestamp");
    options.since = timestamp;
  }
  if (parsed.values["last-minutes"]) {
    const value = Number(parsed.values["last-minutes"]);
    if (!Number.isFinite(value) || value <= 0) throw new Error("--last-minutes requires a positive number");
    options.since = new Date(Date.now() - value * 60_000);
  }
  if (parsed.values.slow) {
    const value = Number(parsed.values.slow);
    if (!Number.isFinite(value) || value < 0) throw new Error("--slow requires a non-negative number");
    options.slowThresholdMs = value;
  }

  return options;
}

if (import.meta.main) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!existsSync(options.logPath)) {
      console.error(`Electron log not found: ${options.logPath}`);
      process.exit(1);
    }

    const rawLogText = readFileSync(options.logPath, "utf8");
    const logText = options.since
      ? filterElectronLogTextSince(rawLogText, options.since)
      : rawLogText;
    const metrics = parseElectronPerfMetrics(logText);
    const searchActivity = summarizeElectronSearchActivity(logText);
    const summary = summarizeElectronPerfMetrics(metrics, {
      limit: options.limit,
      searchActivity,
      slowThresholdMs: options.slowThresholdMs,
    });
    const instrumentationGaps = getElectronInstrumentationGaps(summary);

    if (options.json) {
      console.log(JSON.stringify({
        ...summary,
        instrumentationGaps,
      }, null, 2));
    } else {
      console.log(formatElectronPerfSummary(summary, options.logPath, { since: options.since }));
    }

    if (options.requireMainSpans && instrumentationGaps.length > 0) {
      process.exit(2);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
