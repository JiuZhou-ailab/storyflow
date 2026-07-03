// input: Representative Electron performance log lines
// output: Regression coverage for local performance summary parsing and aggregation
// pos: Guards the Electron perf QA helper against log format drift

import { describe, expect, test } from "bun:test";
import {
  filterElectronLogTextSince,
  formatElectronPerfSummary,
  getElectronInstrumentationGaps,
  parseElectronPerfMetrics,
  summarizeElectronSearchActivity,
  summarizeElectronPerfMetrics,
} from "../electron-perf-summary";

describe("electron perf summary", () => {
  const log = [
    '2026-06-12T10:00:00.000Z [PERF] session.sendMessage.accept: 12.50ms (pendingPlan.cleared:1.0ms -> ack:12.3ms) {"status":"accepted","messageCount":4}',
    "2026-06-12 18:00:01 perf writing.document.readFile: 42ms, chars=1200, file=chapter-1.md",
    "2026-06-12 18:00:02 perf writing.document.paintAfterRead: 315.4ms, file=chapter-1.md",
    "2026-06-12 18:00:03 perf Session switch complete: 88.8ms (session.loaded:20ms)",
    "2026-06-12 18:00:04 perf abcdef12... text_delta.window: 9 events, 1440 chars, 1000.1ms, turn=t1",
  ].join("\n");

  test("parses shared perf and renderer perf lines", () => {
    const metrics = parseElectronPerfMetrics(log);

    expect(metrics.map(metric => metric.name)).toEqual([
      "session.sendMessage.accept",
      "writing.document.readFile",
      "writing.document.paintAfterRead",
      "renderer.sessionSwitch",
      "renderer.textDeltaWindow",
    ]);
    expect(metrics[0]).toEqual(expect.objectContaining({
      durationMs: 12.5,
      source: "shared-perf",
      kind: "latency",
      metadata: { status: "accepted", messageCount: 4 },
    }));
    expect(metrics[1]).toEqual(expect.objectContaining({
      durationMs: 42,
      metadata: { chars: 1200, file: "chapter-1.md" },
    }));
    expect(metrics[4]).toEqual(expect.objectContaining({
      durationMs: 1000.1,
      kind: "throughput-window",
      metadata: { events: 9, chars: 1440 },
    }));
  });

  test("extracts performance text from electron-log JSON message arrays", () => {
    const metrics = parseElectronPerfMetrics([
      '{"timestamp":"2026-06-10T13:54:01.981Z","level":"info","scope":"perf","message":["writing.document.readFile: 7397ms, chars=2193, file=大纲.md"]}',
      '{"timestamp":"2026-06-10T13:54:01.982Z","level":"debug","message":["ignored",123]}',
    ].join("\n"));

    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toEqual(expect.objectContaining({
      name: "writing.document.readFile",
      durationMs: 7397,
      metadata: { chars: 2193, file: "大纲.md" },
    }));
  });

  test("filters log text by timestamp before parsing recent runs", () => {
    const filteredLog = filterElectronLogTextSince([
      '{"timestamp":"2026-06-12T09:59:59.999Z","level":"info","scope":"perf","message":["writing.document.readFile: 999ms, file=old.md"]}',
      '{"timestamp":"2026-06-12T10:00:00.000Z","level":"info","scope":"perf","message":["writing.document.readFile: 42ms, file=new.md"]}',
      '2026-06-12T10:00:01.000Z [PERF] rpc.file.read: 4.2ms {"file":"new.md"}',
      'untimestamped writing.document.readFile: 123ms, file=ignored.md',
    ].join("\n"), new Date("2026-06-12T10:00:00.000Z"));

    const metrics = parseElectronPerfMetrics(filteredLog);

    expect(metrics.map(metric => metric.name)).toEqual([
      "writing.document.readFile",
      "rpc.file.read",
    ]);
    expect(metrics[0]?.metadata).toEqual({ file: "new.md" });
  });

  test("summarizes filesystem search activity from structured Electron logs", () => {
    const searchLog = [
      '{"timestamp":"2026-06-12T10:00:00.000Z","level":"debug","message":["[FS_SEARCH_BATCH] called:","/workspace/a",14]}',
      '{"timestamp":"2026-06-12T10:00:01.000Z","level":"debug","message":["[FS_SEARCH_BATCH] called:","/workspace/a",13]}',
      '{"timestamp":"2026-06-12T10:00:02.000Z","level":"error","message":["[FS_SEARCH_BATCH] query error:","正文",{}]}',
      '{"timestamp":"2026-06-12T10:00:02.500Z","level":"debug","message":["[FS_LIST_FILES] called:","/workspace/a",3]}',
      '{"timestamp":"2026-06-12T10:00:03.000Z","level":"info","message":["[FS_SEARCH] called:","/workspace/a","正文"]}',
      '{"timestamp":"2026-06-12T10:00:04.000Z","level":"info","message":["[FS_SEARCH] called:","/workspace/b","大纲"]}',
      '{"timestamp":"2026-06-12T10:00:05.000Z","level":"info","message":["[FS_SEARCH] returning",4,"results"]}',
      '{"timestamp":"2026-06-12T10:00:06.000Z","level":"info","message":["[FS_SEARCH] returning",1,"results"]}',
    ].join("\n");

    expect(summarizeElectronSearchActivity(searchLog)).toEqual({
      batchCallCount: 2,
      batchQueryErrorCount: 1,
      basePathCount: 2,
      busiestBasePaths: [
        { basePath: "/workspace/a", count: 4 },
        { basePath: "/workspace/b", count: 1 },
      ],
      listFileCallCount: 1,
      singleCallCount: 2,
      singleReturnCount: 2,
      totalBatchRequestCount: 27,
      totalListRootCount: 3,
      totalSingleResultCount: 5,
    });
  });

  test("summarizes operations and slow events", () => {
    const metrics = parseElectronPerfMetrics([
      "writing.document.readFile: 10ms",
      "writing.document.readFile: 20ms",
      "writing.document.readFile: 40ms",
      "Session switch complete: 300ms",
    ].join("\n"));
    const summary = summarizeElectronPerfMetrics(metrics, { slowThresholdMs: 100, limit: 2 });

    expect(summary.operations[0]).toEqual(expect.objectContaining({
      name: "renderer.sessionSwitch",
      count: 1,
      totalMs: 300,
      p95Ms: 300,
    }));
    expect(summary.operations[1]).toEqual(expect.objectContaining({
      name: "writing.document.readFile",
      count: 3,
      avgMs: 70 / 3,
      p50Ms: 20,
      p95Ms: 40,
    }));
    expect(summary.slowest.map(metric => metric.name)).toEqual(["renderer.sessionSwitch"]);
  });

  test("formats a readable markdown summary", () => {
    const summary = summarizeElectronPerfMetrics(parseElectronPerfMetrics(log), {
      slowThresholdMs: 250,
      searchActivity: summarizeElectronSearchActivity([
        '{"timestamp":"2026-06-12T10:00:00.000Z","level":"debug","message":["[FS_SEARCH_BATCH] called:","/workspace/a",14]}',
        '{"timestamp":"2026-06-12T10:00:00.500Z","level":"debug","message":["[FS_LIST_FILES] called:","/workspace/a",3]}',
        '{"timestamp":"2026-06-12T10:00:01.000Z","level":"info","message":["[FS_SEARCH] called:","/workspace/a","正文"]}',
      ].join("\n")),
      limit: 3,
    });
    const output = formatElectronPerfSummary(summary, "/tmp/main.log", {
      since: new Date("2026-06-12T10:00:00.000Z"),
    });

    expect(output).toContain("Electron Performance Summary");
    expect(output).toContain("Log: /tmp/main.log");
    expect(output).toContain("Since: 2026-06-12T10:00:00.000Z");
    expect(output).toContain("Instrumentation Notes");
    expect(output).toContain("`writing.document.readFile` is present but `rpc.file.read` is absent");
    expect(output).toContain("Raw `[FS_SEARCH_BATCH]` logs are present but `fs.searchBatch` spans are absent");
    expect(output).toContain("| Operation | Count | Avg | P50 | P95 | Max | Total |");
    expect(output).toContain("writing.document.paintAfterRead");
    expect(output).toContain("Throughput Windows");
    expect(output).toContain("renderer.textDeltaWindow");
    expect(output).toContain("Filesystem Search Activity");
    expect(output).toContain("batch calls: 1");
    expect(output).toContain("list calls: 1");
    expect(output).toContain("single calls: 1");
  });

  test("detects missing paired main-process spans for runtime evidence gates", () => {
    const staleSummary = summarizeElectronPerfMetrics(
      parseElectronPerfMetrics("writing.document.readFile: 42ms"),
      {
        searchActivity: summarizeElectronSearchActivity(
          [
            '{"timestamp":"2026-06-12T10:00:00.000Z","level":"debug","message":["[FS_SEARCH_BATCH] called:","/workspace/a",14]}',
            '{"timestamp":"2026-06-12T10:00:01.000Z","level":"debug","message":["[FS_LIST_FILES] called:","/workspace/a",3]}',
          ].join("\n")
        ),
      }
    );

    expect(getElectronInstrumentationGaps(staleSummary)).toEqual([
      "`writing.document.readFile` is present but `rpc.file.read` is absent; restart Electron after main-process changes before judging server-side read latency.",
      "Raw `[FS_SEARCH_BATCH]` logs are present but `fs.searchBatch` spans are absent; restart Electron to load batch-search perf metadata.",
      "Raw `[FS_LIST_FILES]` logs are present but `fs.listFiles` spans are absent; restart Electron to load workspace-list perf metadata.",
    ]);

    const currentSummary = summarizeElectronPerfMetrics(
      parseElectronPerfMetrics([
        "writing.document.readFile: 42ms",
        '2026-06-12T10:00:00.000Z [PERF] rpc.file.read: 4.2ms {"file":"new.md"}',
        '2026-06-12T10:00:01.000Z [PERF] fs.searchBatch: 8.1ms {"requestCount":14}',
        '2026-06-12T10:00:02.000Z [PERF] fs.listFiles: 3.1ms {"rootCount":3}',
      ].join("\n")),
      {
        searchActivity: summarizeElectronSearchActivity(
          [
            '{"timestamp":"2026-06-12T10:00:00.000Z","level":"debug","message":["[FS_SEARCH_BATCH] called:","/workspace/a",14]}',
            '{"timestamp":"2026-06-12T10:00:01.000Z","level":"debug","message":["[FS_LIST_FILES] called:","/workspace/a",3]}',
          ].join("\n")
        ),
      }
    );

    expect(getElectronInstrumentationGaps(currentSummary)).toEqual([]);
  });

  test("can require workspace list-file activity for known-root QA runs", () => {
    const summary = summarizeElectronPerfMetrics(
      parseElectronPerfMetrics('2026-06-12T10:00:01.000Z [PERF] fs.searchBatch: 8.1ms {"requestCount":14}'),
      {
        searchActivity: summarizeElectronSearchActivity(
          '{"timestamp":"2026-06-12T10:00:00.000Z","level":"debug","message":["[FS_SEARCH_BATCH] called:","/workspace/a",14]}'
        ),
      }
    );

    expect(getElectronInstrumentationGaps(summary, { expectListFiles: true })).toEqual([
      "Expected at least one `fs.listFiles` / `[FS_LIST_FILES]` event for known-root writing workspace QA, but none were found.",
    ]);
  });

  test("keeps throughput windows out of latency summaries", () => {
    const summary = summarizeElectronPerfMetrics(parseElectronPerfMetrics(log), {
      slowThresholdMs: 250,
      limit: 5,
    });

    expect(summary.metrics.length).toBe(5);
    expect(summary.latencyMetrics.length).toBe(4);
    expect(summary.throughputWindows.length).toBe(1);
    expect(summary.operations.map(operation => operation.name)).not.toContain("renderer.textDeltaWindow");
    expect(summary.slowest.map(metric => metric.name)).toEqual(["writing.document.paintAfterRead"]);
  });
});
