// input: Corrupted Pi assistant messages and temporary JSONL session files.
// output: Regression coverage for Pi resume sanitization before compaction/replay.
// pos: Tests the Pi subprocess session recovery guard.

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
  sanitizeAssistantMessageForResume,
  sanitizeSessionFileForResume,
} from './pi-session-sanitizer.ts';

const emptyUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

describe('Pi session resume sanitizer', () => {
  it('removes incomplete tool calls from interrupted assistant error messages', () => {
    const message = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Partial response before the stream failed.' },
        { type: 'toolCall', id: 'toolu_01', arguments: { query: 'hot projects' } },
      ],
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      usage: emptyUsage,
      stopReason: 'error',
      errorMessage: 'Anthropic stream ended before message_stop',
      timestamp: 1,
    };

    const result = sanitizeAssistantMessageForResume(message);

    expect(result.changed).toBe(true);
    expect(result.removedToolCalls).toBe(1);
    expect(message.content).toEqual([
      { type: 'text', text: 'Partial response before the stream failed.' },
    ]);
    expect(message.errorMessage).toBe('Anthropic stream ended before message_stop');
  });

  it('rewrites persisted Pi session files so corrupted assistant turns can be resumed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-session-sanitizer-'));
    const sessionFile = join(dir, 'session.jsonl');
    const header = {
      type: 'session',
      version: 3,
      id: 'session-1',
      timestamp: '2026-05-11T00:00:00.000Z',
      cwd: dir,
    };
    const userEntry = {
      type: 'message',
      id: 'u1',
      parentId: null,
      timestamp: '2026-05-11T00:00:01.000Z',
      message: { role: 'user', content: 'continue', timestamp: 1 },
    };
    const assistantEntry = {
      type: 'message',
      id: 'a1',
      parentId: 'u1',
      timestamp: '2026-05-11T00:00:02.000Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Working...' },
          { type: 'toolCall', id: 'toolu_01', arguments: {} },
        ],
        api: 'anthropic-messages',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        usage: emptyUsage,
        stopReason: 'error',
        errorMessage: 'Anthropic stream ended before message_stop',
        timestamp: 2,
      },
    };
    writeFileSync(
      sessionFile,
      [header, userEntry, assistantEntry].map(entry => JSON.stringify(entry)).join('\n') + '\n',
    );

    const result = sanitizeSessionFileForResume(sessionFile);

    expect(result.changed).toBe(true);
    expect(result.removedToolCalls).toBe(1);
    const lines = readFileSync(sessionFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(lines[0]).toEqual(header);
    expect(lines[2].message.content).toEqual([{ type: 'text', text: 'Working...' }]);
  });
});
