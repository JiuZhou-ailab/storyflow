// input: Chunked UTF-8 JSONL containing Unicode line separators
// output: Regression proof that only LF terminates a JSONL record
// pos: Focused contract test for the shared subprocess framing primitive

import { describe, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { readJsonLines } from './jsonl.ts';

describe('readJsonLines', () => {
  test('splits only on LF across UTF-8 chunks', async () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    const ended = new Promise<void>((resolve) => readJsonLines(stream, (line) => lines.push(line), resolve));
    const input = Buffer.from(`${JSON.stringify({ text: '一\u2028二\u2029三🙂' })}\r\n{"ok":true}\n`);

    stream.write(input.subarray(0, input.indexOf(Buffer.from('🙂')) + 1));
    stream.end(input.subarray(input.indexOf(Buffer.from('🙂')) + 1));
    await ended;

    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { text: '一\u2028二\u2029三🙂' },
      { ok: true },
    ]);
  });
});
