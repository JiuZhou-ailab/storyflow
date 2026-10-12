import { expect, it, spyOn } from 'bun:test'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isWorkspaceRootAvailable } from '../project-registry'
import { inspectWorkspaceStateConfig, loadWorkspaceConfig } from '../storage'
import { readStoredConfig } from '../../config/stored-config'

it('does not turn a busy Project into a missing Project or migrate its ordinary files', () => {
  const rootPath = fs.mkdtempSync(join(tmpdir(), 'project-busy-'))
  fs.mkdirSync(join(rootPath, '.craft-agent'))
  const configPath = join(rootPath, '.craft-agent/config.json')
  fs.writeFileSync(configPath, JSON.stringify({ id: 'directory', name: 'Project', slug: 'project', createdAt: 1, updatedAt: 1 }))
  const original = fs.readFileSync
  const busy = Object.assign(new Error('busy'), { code: 'EPERM', path: configPath })
  const read = spyOn(fs, 'readFileSync').mockImplementation(((path: any, ...args: any[]) => {
    if (String(path) === configPath) throw busy
    return (original as any)(path, ...args)
  }) as any)
  try {
    expect(isWorkspaceRootAvailable({ id: 'project', rootPath, directoryConfigId: 'directory' } as any)).toBe(true)
    expect(() => inspectWorkspaceStateConfig(rootPath)).toThrow(busy)
    expect(() => loadWorkspaceConfig(rootPath)).toThrow(busy)
    expect(() => readStoredConfig(configPath)).toThrow(expect.objectContaining({ code: 'CONFIG_BUSY', cause: busy }))
  } finally {
    read.mockRestore()
    fs.rmSync(rootPath, { recursive: true, force: true })
  }
})
