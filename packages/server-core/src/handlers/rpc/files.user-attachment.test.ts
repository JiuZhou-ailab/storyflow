// input: Persisted draft refs and real filesystem paths in an isolated host
// output: Attachment RPC authorization and size regression coverage
// pos: Exercises the user-file read trust boundary without mocking storage
import { expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runIsolatedJson } from '../../sessions/isolated-test-runner'

it('snapshots startup drafts once, resolving aliases and retaining the 50 MiB cap', () => {
  const dir = mkdtempSync(join(tmpdir(), 'user-attachment-'))
  try {
    const result = runIsolatedJson<any>(dir, 'ATTACHMENTS', `
      import { writeFileSync, symlinkSync, openSync, ftruncateSync, closeSync } from 'node:fs';
      import { join } from 'node:path';
      import { registerFilesHandlers } from ${JSON.stringify(join(import.meta.dir, 'files.ts'))};
      import { initializeUserAttachmentAuthorization } from ${JSON.stringify(join(import.meta.dir, 'user-attachment-access.ts'))};
      import { setSessionDraft, deleteSessionDraft } from '@craft-agent/shared/config';
      import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
      const dir = process.env.CRAFT_CONFIG_DIR;
      const allowed = join(dir, 'allowed.txt'), secret = join(dir, 'secret.txt');
      const alias = join(dir, 'alias.txt'), large = join(dir, 'large.txt');
      writeFileSync(allowed, 'allowed'); writeFileSync(secret, 'secret');
      symlinkSync(allowed, alias);
      const fd = openSync(large, 'w'); ftruncateSync(fd, 50 * 1024 * 1024 + 1); closeSync(fd);
      setSessionDraft('test', { text: '', attachments: [
        { path: join(dir, 'missing.txt'), name: 'missing' },
        { path: alias, name: 'allowed' }, { path: large, name: 'large' },
        { path: secret, name: 'inline', content: { type: 'text', mimeType: 'text/plain', size: 11, text: 'pasted text' } },
      ] });
      initializeUserAttachmentAuthorization();
      const handlers = new Map(), warnings = [];
      registerFilesHandlers({ handle: (key, fn) => handlers.set(key, fn) }, {
        platform: {
          logger: { info() {}, warn: (...args) => warnings.push(args), error() {}, debug() {} },
          imageProcessor: { process: async () => { throw new Error('not an image'); } },
        },
      });
      const read = path => handlers.get(RPC_CHANNELS.file.READ_USER_ATTACHMENT)({}, path);
      const allowedText = (await read(allowed))?.text;
      const aliasText = (await read(join(dir, 'unused', '..', 'alias.txt')))?.text;
      setSessionDraft('late', { text: '', attachments: [{ path: secret, name: 'secret' }] });
      initializeUserAttachmentAuthorization();
      const denied = await read(secret);
      const tooLarge = await read(large);
      deleteSessionDraft('test');
      const removed = (await read(allowed))?.text;
      console.log('ATTACHMENTS=' + JSON.stringify({ allowedText, aliasText, denied, tooLarge, removed, warnings: warnings.length }));
    `)
    expect(result.allowedText).toBe('allowed')
    expect(result.aliasText).toBe('allowed')
    expect(result.denied).toBeNull()
    expect(result.tooLarge).toBeNull()
    expect(result.removed).toBe('allowed')
    expect(result.warnings).toBeGreaterThanOrEqual(2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('preserves legacy reads and draft writes on remote hosts and remote workspaces', () => {
  const dir = mkdtempSync(join(tmpdir(), 'remote-attachment-'))
  try {
    const result = runIsolatedJson<any>(dir, 'REMOTE', `
      import { writeFileSync } from 'node:fs';
      import { join } from 'node:path';
      import { registerFilesHandlers } from ${JSON.stringify(join(import.meta.dir, 'files.ts'))};
      import { registerSettingsHandlers } from ${JSON.stringify(join(import.meta.dir, 'settings.ts'))};
      import { initializeUserAttachmentAuthorization } from ${JSON.stringify(join(import.meta.dir, 'user-attachment-access.ts'))};
      const path = join(process.env.CRAFT_CONFIG_DIR, 'remote.txt'); writeFileSync(path, 'legacy');
      const handlers = new Map();
      const server = { handle: (key, fn) => handlers.set(key, fn) };
      const deps = { resolveRuntimeWorkspaceById: () => ({ remoteServer: { url: 'wss://remote.test' } }),
        platform: { logger: { info(){}, warn(){}, error(){}, debug(){} } } };
      registerFilesHandlers(server, deps); registerSettingsHandlers(server, deps);
      const host = (await handlers.get('file:readUserAttachment')({}, path))?.text;
      initializeUserAttachmentAuthorization();
      const ctx = { workspaceId: 'remote' };
      await handlers.get('drafts:set')(ctx, 'remote', { text: '', attachments: [{ path, name: 'remote' }] });
      const remote = (await handlers.get('file:readUserAttachment')(ctx, path))?.text;
      const refs = (await handlers.get('drafts:get')(ctx, 'remote')).attachments.length;
      console.log('REMOTE=' + JSON.stringify({ host, remote, refs }));
    `)
    expect(result).toEqual({ host: 'legacy', remote: 'legacy', refs: 1 })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
