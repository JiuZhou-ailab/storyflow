import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createCipheriv, createHash, pbkdf2Sync, randomBytes } from 'crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { homedir, hostname, tmpdir, userInfo } from 'os';
import { join } from 'path';
import { SecureStorageBackend } from '../secure-storage.ts';

const id = { type: 'anthropic_api_key' } as const;
const credential = { value: 'test-secret' };
let directory: string;
let file: string;
let warn: ReturnType<typeof spyOn>;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'secure-storage-test-'));
  file = join(directory, 'credentials.enc');
  warn = spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  rmSync(directory, { recursive: true, force: true });
});

function writeFixture(identity: 'fallback' | 'legacy') {
  const salt = randomBytes(32);
  const hash = createHash('sha256');
  if (identity === 'legacy') {
    hash.update(hostname()).update(userInfo().username).update(homedir()).update('craft-agent-v1');
  } else {
    hash.update(`${userInfo().username}:${homedir()}`).update('craft-agent-v2');
  }
  const key = pbkdf2Sync(hash.digest(), salt, 100000, 32, 'sha256');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const payload = JSON.stringify({
    version: 1,
    credentials: { 'anthropic_api_key::global': credential },
    metadata: { createdAt: 1, updatedAt: 1 },
  });
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const header = Buffer.alloc(64);
  header.write('CRAFT01\0');
  salt.copy(header, 12);
  writeFileSync(file, Buffer.concat([header, iv, cipher.getAuthTag(), encrypted]), { mode: 0o600 });
}

function backups() {
  return readdirSync(directory).filter(name => name.startsWith('credentials.enc.corrupt-'));
}

describe('SecureStorageBackend recovery', () => {
  test.each(['short', 'magic', 'authentication'])('backs up %s corruption and preserves backup on subsequent writes', async kind => {
    const backend = new SecureStorageBackend(file, () => 'stable-test-machine');
    await backend.set(id, credential);
    let damaged = readFileSync(file);
    if (kind === 'short') damaged = Buffer.from('incomplete');
    else if (kind === 'magic') damaged[0] = 0;
    else damaged[damaged.length - 1] = damaged[damaged.length - 1]! ^ 1;
    writeFileSync(file, damaged);
    backend.clearCache();

    expect(await backend.get(id)).toBeNull();
    expect(backups()).toHaveLength(1);
    const backup = join(directory, backups()[0]!);
    expect(readFileSync(backup)).toEqual(damaged);
    expect(warn).toHaveBeenCalled();
    await backend.set(id, { value: 'replacement' });
    expect(readFileSync(backup)).toEqual(damaged);
    expect(await new SecureStorageBackend(file, () => 'stable-test-machine').get(id)).toEqual({ value: 'replacement' });
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test('retains at most three corrupt backups', async () => {
    const backend = new SecureStorageBackend(file, () => 'stable-test-machine');
    for (let i = 0; i < 5; i++) {
      writeFileSync(file, `damaged-${i}`);
      expect(await backend.get(id)).toBeNull();
      expect(backups().map(name => readFileSync(join(directory, name), 'utf8'))).toContain(`damaged-${i}`);
    }
    expect(backups()).toHaveLength(3);
  });

  test('a missing machine identity leaves stable-encrypted bytes untouched and can recover on retry', async () => {
    await new SecureStorageBackend(file, () => 'stable-test-machine').set(id, credential);
    const original = readFileSync(file);
    let machineId: string | null = null;
    const backend = new SecureStorageBackend(file, () => machineId);
    await expect(backend.get(id)).rejects.toThrow('Machine identity unavailable');
    await expect(backend.set(id, { value: 'replacement' })).rejects.toThrow('Machine identity unavailable');
    await expect(backend.delete(id)).rejects.toThrow('Machine identity unavailable');
    expect(readFileSync(file)).toEqual(original);
    expect(backups()).toEqual([]);
    machineId = 'stable-test-machine';
    expect(await backend.get(id)).toEqual(credential);
    expect(readFileSync(file)).toEqual(original);
  });

  test.each(['fallback', 'legacy'] as const)('%s credentials remain readable without identity, but cannot be overwritten', async identity => {
    writeFixture(identity);
    const original = readFileSync(file);
    const backend = new SecureStorageBackend(file, () => null);
    expect(await backend.get(id)).toEqual(credential);
    expect(readFileSync(file)).toEqual(original);
    await expect(backend.set(id, { value: 'replacement' })).rejects.toThrow('refusing to overwrite');
    await expect(backend.delete(id)).rejects.toThrow('refusing to overwrite');
    expect(await backend.get(id)).toEqual(credential);
    expect(readFileSync(file)).toEqual(original);
    expect(backups()).toEqual([]);
  });

  test.each(['fallback', 'legacy'] as const)('migrates %s credentials only when stable identity is available', async identity => {
    writeFixture(identity);
    const original = readFileSync(file);
    expect(await new SecureStorageBackend(file, () => 'stable-test-machine').get(id)).toEqual(credential);
    expect(readFileSync(file)).not.toEqual(original);
    expect(await new SecureStorageBackend(file, () => 'stable-test-machine').get(id)).toEqual(credential);
    expect(backups()).toEqual([]);
  });

  test('read errors reject writes instead of initializing an empty store', async () => {
    mkdirSync(file);
    const backend = new SecureStorageBackend(file, () => 'stable-test-machine');
    await expect(backend.set(id, credential)).rejects.toThrow();
    expect(statSync(file).isDirectory()).toBe(true);
    expect(backups()).toEqual([]);
  });

  test('warning logs omit secrets and machine identifiers', async () => {
    await new SecureStorageBackend(file, () => 'stable-test-machine').set(id, credential);
    await expect(new SecureStorageBackend(file, () => null).get(id)).rejects.toThrow();
    const output = JSON.stringify(warn.mock.calls);
    expect(output).toContain('Machine identity unavailable');
    expect(output).not.toContain(credential.value);
    expect(output).not.toContain('stable-test-machine');
    expect(output).not.toContain(userInfo().username);
  });

  test('fallback creation remains readable after machine identity recovers', async () => {
    await new SecureStorageBackend(file, () => null).set(id, credential);
    expect(await new SecureStorageBackend(file, () => 'stable-test-machine').get(id)).toEqual(credential);
    expect(backups()).toEqual([]);
  });
});

describe('SecureStorageBackend writes', () => {
  test('writes atomically with owner-only permissions and no temp residue', async () => {
    const backend = new SecureStorageBackend(file, () => 'stable-id');
    await backend.set(id, credential);
    await backend.set({ type: 'claude_oauth' }, { value: 'second' });

    expect(readdirSync(directory)).toEqual(['credentials.enc']);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(await new SecureStorageBackend(file, () => 'stable-id').get(id)).toEqual(credential);
  });
});
