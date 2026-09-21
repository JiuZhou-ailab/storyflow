import { expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareLlmOutputFile } from '../llm-output-file.ts';

test('output publishes complete exact bytes once, preserves conflicts and never publishes partials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-output-'));
  try {
    const content = '第一集\n'.repeat(10000);
    const output = await prepareLlmOutputFile('episode.txt', root);
    const reference = await output.publish({ status: 'completed', text: content });
    expect(reference.text.length).toBeLessThan(2000);
    expect(await readFile(join(root, 'episode.txt'), 'utf8')).toBe(content);
    await expect(prepareLlmOutputFile('episode.txt', root)).rejects.toThrow('exists');
    const partial = await prepareLlmOutputFile('partial.txt', root);
    await partial.publish({ status: 'incomplete', text: 'partial' });
    expect(await readdir(root)).toEqual(['episode.txt']);
    const conflict = await prepareLlmOutputFile('conflict.txt', root);
    await writeFile(join(root, 'conflict.txt'), 'other writer');
    await expect(conflict.publish({ status: 'completed', text: 'new' })).rejects.toThrow();
    expect(await readFile(join(root, 'conflict.txt'), 'utf8')).toBe('other writer');
    await symlink(join(root, 'absent'), join(root, 'link'));
    await expect(prepareLlmOutputFile('link', root)).rejects.toThrow('exists');
    await expect(prepareLlmOutputFile('../escape', root)).rejects.toThrow('traversal');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Host denies safe-mode output before inference and authorizes create-only delivery', async () => {
  const { PiAgent } = await import('../pi-agent.ts');
  class FixtureHost extends PiAgent {
    calls = 0;
    override async queryLlm() { this.calls++; return { status: 'completed' as const, text: 'Exact episode\n' }; }
    execute(input: Record<string, unknown>) { return this.executeSessionTool('call_llm', input); }
  }
  const root = await mkdtemp(join(tmpdir(), 'llm-host-'));
  const agent = new FixtureHost({ workspace: { id: 'llm-host-fixture', name: 'Fixture', rootPath: root },
    session: { id: `fixture-${Date.now()}`, workingDirectory: root }, isHeadless: true } as any);
  try {
    agent.setPermissionMode('safe');
    expect((await agent.execute({ prompt: 'episode', outputPath: 'episode.txt' })).isError).toBe(true);
    expect(agent.calls).toBe(0);
    agent.setPermissionMode('allow-all');
    expect((await agent.execute({ prompt: 'episode', outputPath: 'episode.txt' })).isError).toBe(false);
    expect(agent.calls).toBe(1);
    expect(await readFile(join(root, 'episode.txt'), 'utf8')).toBe('Exact episode\n');
    expect((await agent.execute({ prompt: 'episode', outputPath: 'episode.txt' })).isError).toBe(true);
    expect(agent.calls).toBe(1);
  } finally { agent.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('directory replacement and cancellation cannot publish into another directory', async () => {
  const { mkdir, rename } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'llm-publish-race-'));
  try {
    await mkdir(join(root, 'output')); await mkdir(join(root, 'outside'));
    const output = await prepareLlmOutputFile('output/episode.txt', root);
    await rename(join(root, 'output'), join(root, 'moved'));
    await symlink(join(root, 'outside'), join(root, 'output'));
    await expect(output.publish({ status: 'completed', text: 'episode' })).rejects.toThrow('directory changed');
    expect(await readdir(join(root, 'outside'))).toEqual([]);
    const cancelled = await prepareLlmOutputFile('cancelled.txt', root);
    expect((await cancelled.publish({ status: 'completed', text: 'late' }, () => true)).status).toBe('cancelled');
    expect((await readdir(root)).includes('cancelled.txt')).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
