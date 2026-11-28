import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAccessSignature, readAccessSignature, readAccessSignatureSync } from './file-access.ts';

describe('parseAccessSignature', () => {
  it('reads macOS ACEs below the long listing', () => {
    const plain = '-rw-r--r--  1 dev  staff  78 Nov 28 10:00 /w/history.jsonl\n';
    const withAcl = '-rw-r--r--+ 1 dev  staff  78 Nov 28 10:00 /w/history.jsonl\n 0: user:nobody deny read\n';
    expect(parseAccessSignature('darwin', 'history.jsonl', plain)).toBe('');
    expect(parseAccessSignature('darwin', 'history.jsonl', withAcl)).toBe('0: user:nobody deny read');
    expect(parseAccessSignature('darwin', 'history.jsonl', '')).toBeNull();
  });

  it('compares Linux security labels and treats an ACL or a hidden label as unconfirmable', () => {
    // Shapes printed by GNU ls 9.7 and uutils ls 0.2.2 for `ls -ldnZ`.
    const listing = (marker: string, label: string) => `-rw-r--r--${marker} 1 1000 1000 ${label} 78 Nov 28 10:00 /w/h\n`;
    const homeLabel = parseAccessSignature('linux', 'h', listing('.', 'unconfined_u:object_r:user_home_t:s0'));
    expect(parseAccessSignature('linux', 'h', listing('', '?'))).toBe('');
    expect(homeLabel).toBe('unconfined_u:object_r:user_home_t:s0');
    expect(parseAccessSignature('linux', 'h', listing('.', 'system_u:object_r:secret_t:s0'))).not.toBe(homeLabel);
    expect(parseAccessSignature('linux', 'h', listing('.', '?'))).toBeNull();
    expect(parseAccessSignature('linux', 'h', listing('+', 'unconfined_u:object_r:user_home_t:s0'))).toBeNull();
    expect(parseAccessSignature('linux', 'h', listing('+', '?'))).toBeNull();
    expect(parseAccessSignature('linux', 'h', '-rw-r--r--.\n')).toBeNull();
    expect(parseAccessSignature('linux', 'h', 'ls: cannot access\n')).toBeNull();
  });

  it('compares Windows ACEs without the echoed file name or summary', () => {
    const icacls = (name: string, extra = '') => [
      `${name} NT AUTHORITY\\SYSTEM:(I)(F)`,
      `${' '.repeat(name.length + 1)}BUILTIN\\Administrators:(I)(F)`,
      `${' '.repeat(name.length + 1)}DESKTOP-1\\dev:(I)(F)`,
      ...(extra ? [`${' '.repeat(name.length + 1)}${extra}`] : []),
      '',
      'Successfully processed 1 files; Failed processing 0 files',
      '',
    ].join('\r\n');
    const original = parseAccessSignature('win32', 'history.jsonl', icacls('history.jsonl'));
    expect(original).toBe('NT AUTHORITY\\SYSTEM:(I)(F)\nBUILTIN\\Administrators:(I)(F)\nDESKTOP-1\\dev:(I)(F)');
    expect(parseAccessSignature('win32', 'history.jsonl.1.x.tmp', icacls('history.jsonl.1.x.tmp'))).toBe(original);
    expect(parseAccessSignature('win32', 'history.jsonl', icacls('history.jsonl', 'DESKTOP-1\\guest:(DENY)(R)')))
      .not.toBe(original);
    expect(parseAccessSignature('win32', 'other.jsonl', icacls('history.jsonl'))).toBeNull();
  });

  it('cannot confirm access on other platforms', () => {
    expect(parseAccessSignature('freebsd', 'h', '-rw-r--r-- 1 dev dev 78 Nov 28 10:00 /w/h\n')).toBeNull();
  });
});

describe.skipIf(!['darwin', 'linux', 'win32'].includes(process.platform))('readAccessSignature', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'file-access test '));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('gives sibling files created the same way equal signatures, sync and async', async () => {
    const file = join(dir, 'history file.jsonl');
    const sibling = `${file}.1.x.tmp`;
    writeFileSync(file, 'x\n');
    writeFileSync(sibling, '');
    const signature = readAccessSignatureSync(file);
    expect(signature).not.toBeNull();
    // Windows files carry inherited ACEs; Linux files may carry the directory's default security label.
    if (process.platform === 'win32') expect(signature).toContain(':(I)');
    if (process.platform === 'darwin') expect(signature).toBe('');
    expect(readAccessSignatureSync(sibling)).toBe(signature);
    expect(await readAccessSignature(file)).toBe(signature);
  });

  it.skipIf(process.platform !== 'darwin')('reports a macOS ACE', async () => {
    const file = join(dir, 'history.jsonl');
    writeFileSync(file, 'x\n');
    execFileSync('chmod', ['+a', 'nobody deny read', file]);
    expect(readAccessSignatureSync(file)).toContain('user:nobody deny read');
    expect(await readAccessSignature(file)).toBe(readAccessSignatureSync(file));
  });

  it.skipIf(process.platform !== 'linux')('reports a Linux security label that differs from a new sibling', async () => {
    const file = join(dir, 'history.jsonl');
    const sibling = `${file}.1.x.tmp`;
    writeFileSync(file, 'x\n');
    writeFileSync(sibling, '');
    // A label no policy defines: writable as a raw xattr only where no SELinux policy checks it.
    const label = 'system_u:object_r:storyflow_secret_t:s0';
    if (spawnSync('setfattr', ['-n', 'security.selinux', '-v', label, file]).status !== 0) return;
    const signature = readAccessSignatureSync(file);
    // GNU ls prints the label; uutils ls marks any extended attribute with "+".
    expect([label, null]).toContain(signature);
    expect(signature).not.toBe(readAccessSignatureSync(sibling));
    expect(await readAccessSignature(file)).toBe(signature);
  });

  it('cannot confirm a missing file', async () => {
    const file = join(dir, 'missing.jsonl');
    expect(readAccessSignatureSync(file)).toBeNull();
    expect(await readAccessSignature(file)).toBeNull();
  });
});
