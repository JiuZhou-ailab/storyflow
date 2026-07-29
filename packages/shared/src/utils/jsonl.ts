// input: A UTF-8 readable stream containing LF-delimited JSON records
// output: Complete JSONL records without splitting valid Unicode line separators
// pos: Shared stdio framing primitive for subprocess JSONL protocols

import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

export function readJsonLines(
  stream: Readable,
  onLine: (line: string) => void,
  onEnd?: () => void,
): () => void {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let ended = false;

  const onData = (chunk: Buffer | string): void => {
    buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);

    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      onLine(line);
      newline = buffer.indexOf('\n');
    }
  };

  const finish = (): void => {
    if (ended) return;
    ended = true;
    const line = (buffer + decoder.end()).replace(/\r$/, '');
    if (line) onLine(line);
    onEnd?.();
  };

  stream.on('data', onData);
  stream.once('end', finish);
  stream.once('close', finish);

  return () => {
    stream.off('data', onData);
    stream.off('end', finish);
    stream.off('close', finish);
  };
}
