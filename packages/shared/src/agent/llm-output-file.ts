// input: Host-authorized output path and one completed query
// output: Create-only published UTF-8 artifact and bounded parent reference
// pos: call_llm filesystem boundary; inference and permission policy remain with callers
import { lstat, realpath, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import type { LLMQueryResult } from './llm-tool.ts';

// A child cwd is an OS-held directory reference, even after a rename. All writes
// and cleanup below are relative to it, never through a replaceable parent path.
const publishScript = `
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
try {
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const same = s => String(s.dev) === input.dev && String(s.ino) === input.ino;
if (!same(fs.statSync('.')) || !same(fs.statSync(input.parent))) throw new Error('Output directory changed');
const temporary = '.call-llm-' + randomUUID();
let published = false;
let created = false;
let identity;
try {
  const fd = fs.openSync(temporary, 'wx', 0o600);
  created = true;
  try { fs.writeFileSync(fd, input.text, 'utf8'); fs.fsyncSync(fd); identity = fs.fstatSync(fd); }
  finally { fs.closeSync(fd); }
  fs.linkSync(temporary, input.name);
  published = true;
  if (!same(fs.statSync(input.parent))) throw new Error('Output directory changed');
  fs.writeSync(1, 'published');
} catch (error) {
  if (published) {
    const target = fs.lstatSync(input.name);
    if (target.dev === identity.dev && target.ino === identity.ino) fs.unlinkSync(input.name);
  }
  throw error;
} finally {
  if (created) {
    try { fs.unlinkSync(temporary); }
    catch (error) { if (!published) throw error; console.error('Published output; temporary cleanup failed'); }
  }
}
} catch (error) {
  // Bun 1.3.14 can lose uncaught errors after reading piped stdin.
  fs.writeSync(2, String(error.stack || error));
  process.exitCode = 1;
}
`;

export async function prepareLlmOutputFile(path: string, cwd: string) {
  if (!path || path.split(/[\\/]/).includes('..')) throw new Error('outputPath cannot contain parent traversal');
  const requested = resolve(cwd, path);
  const parent = await realpath(dirname(requested));
  const target = join(parent, basename(requested));
  const parentIdentity = await stat(parent);
  try { await lstat(target); throw new Error(`Output already exists: ${target}`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return {
    path: target,
    async publish(result: LLMQueryResult, isCancelled = () => false): Promise<LLMQueryResult> {
      if (isCancelled()) return { ...result, status: 'cancelled', warning: 'Query cancelled' };
      if (result.status !== 'completed') return result;
      // ponytail: synchronous publication (5s timeout) serializes commit with Host cancellation;
      // use a native directory-relative API if representative output sizes show this blocking
      // the Host responsiveness budget, preserving create-only publication and directory identity.
      const published = spawnSync(process.execPath, ['-e', publishScript], {
        cwd: parent, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        input: JSON.stringify({ parent, name: basename(target), dev: String(parentIdentity.dev),
          ino: String(parentIdentity.ino), text: result.text }),
        encoding: 'utf8', timeout: 5000, maxBuffer: 65536, windowsHide: true,
      });
      if (published.stdout !== 'published') throw new Error(published.error
        ? `Output publication could not be confirmed; inspect ${target} before retrying: ${published.error.message}`
        : published.stderr || 'Output publication failed');
      const { text, ...metadata } = result;
      return { ...result, text: JSON.stringify({ ...metadata, path: target,
        representation: 'preview', preview: text.slice(0, 500), bytes: Buffer.byteLength(text) }) };
    },
  };
}
