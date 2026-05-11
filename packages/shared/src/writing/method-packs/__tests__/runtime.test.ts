import { describe, expect, it } from "bun:test";
import { CLAUDE_BOOK_METHOD_PACK } from "../claude-book.ts";
import { buildMethodPackRuntimePreamble } from "../runtime.ts";

describe("method pack runtime preamble", () => {
  it("summarizes the Claude-Book path contract", () => {
    const preamble = buildMethodPackRuntimePreamble(CLAUDE_BOOK_METHOD_PACK);

    expect(preamble).toContain("novel.claude-book");
    expect(preamble).toContain("bible/");
    expect(preamble).toContain("story/chapters/");
    expect(preamble).toContain("state/current/");
    expect(preamble).toContain("timeline/");
    expect(preamble).toContain(".work/");
  });
});
