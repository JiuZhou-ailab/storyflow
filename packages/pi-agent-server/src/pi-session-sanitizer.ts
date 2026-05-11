// input: Pi SDK assistant messages and JSONL session files that may contain interrupted stream artifacts.
// output: Sanitized in-memory messages and persisted session JSONL safe for Pi resume/compaction.
// pos: Recovery guard between Craft's Pi subprocess wrapper and Pi SDK session persistence.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export interface PiSessionSanitizeResult {
  changed: boolean;
  removedToolCalls: number;
  normalizedToolCalls: number;
}

interface MutableRecord {
  [key: string]: unknown;
}

function emptyResult(): PiSessionSanitizeResult {
  return {
    changed: false,
    removedToolCalls: 0,
    normalizedToolCalls: 0,
  };
}

function mergeResult(target: PiSessionSanitizeResult, next: PiSessionSanitizeResult): void {
  target.changed ||= next.changed;
  target.removedToolCalls += next.removedToolCalls;
  target.normalizedToolCalls += next.normalizedToolCalls;
}

function isRecord(value: unknown): value is MutableRecord {
  return typeof value === 'object' && value !== null;
}

function isSafeToolCall(block: MutableRecord): boolean {
  return (
    block.type === 'toolCall' &&
    typeof block.id === 'string' &&
    block.id.length > 0 &&
    typeof block.name === 'string' &&
    block.name.length > 0
  );
}

function normalizeSafeToolCall(block: MutableRecord): {
  block: MutableRecord;
  changed: boolean;
} {
  if (isRecord(block.arguments)) {
    return { block, changed: false };
  }
  return {
    block: {
      ...block,
      arguments: {},
    },
    changed: true,
  };
}

function ensureTextFallback(content: MutableRecord[]): {
  content: MutableRecord[];
  changed: boolean;
} {
  if (content.length > 0) {
    return { content, changed: false };
  }
  return {
    content: [{ type: 'text', text: '' }],
    changed: true,
  };
}

export function sanitizeAssistantMessageForResume(message: unknown): PiSessionSanitizeResult {
  const result = emptyResult();
  if (!isRecord(message) || message.role !== 'assistant' || !Array.isArray(message.content)) {
    return result;
  }

  const stopReason = typeof message.stopReason === 'string' ? message.stopReason : undefined;
  const shouldDropAllToolCalls = stopReason === 'error' || stopReason === 'aborted';
  const sanitizedContent: MutableRecord[] = [];

  for (const block of message.content) {
    if (!isRecord(block)) {
      result.changed = true;
      continue;
    }

    if (block.type !== 'toolCall') {
      sanitizedContent.push(block);
      continue;
    }

    if (shouldDropAllToolCalls || !isSafeToolCall(block)) {
      result.changed = true;
      result.removedToolCalls++;
      continue;
    }

    const normalized = normalizeSafeToolCall(block);
    if (normalized.changed) {
      result.changed = true;
      result.normalizedToolCalls++;
    }
    sanitizedContent.push(normalized.block);
  }

  const fallback = ensureTextFallback(sanitizedContent);
  if (fallback.changed) {
    result.changed = true;
  }

  if (result.changed) {
    message.content = fallback.content;
  }

  return result;
}

function sanitizeSessionEntry(entry: unknown): PiSessionSanitizeResult {
  if (!isRecord(entry) || entry.type !== 'message') {
    return emptyResult();
  }
  return sanitizeAssistantMessageForResume(entry.message);
}

export function sanitizeSessionFileForResume(filePath: string): PiSessionSanitizeResult {
  const result = emptyResult();
  if (!existsSync(filePath)) {
    return result;
  }

  const original = readFileSync(filePath, 'utf8');
  const hadTrailingNewline = original.endsWith('\n');
  const rewrittenLines = original.split('\n').map((line) => {
    if (!line.trim()) {
      return line;
    }

    try {
      const entry = JSON.parse(line);
      const entryResult = sanitizeSessionEntry(entry);
      mergeResult(result, entryResult);
      return entryResult.changed ? JSON.stringify(entry) : line;
    } catch {
      return line;
    }
  });

  if (result.changed) {
    let rewritten = rewrittenLines.join('\n');
    if (hadTrailingNewline && !rewritten.endsWith('\n')) {
      rewritten += '\n';
    }
    writeFileSync(filePath, rewritten);
  }

  return result;
}
