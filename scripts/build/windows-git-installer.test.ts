// input: Electron Builder Windows configuration and the custom NSIS installer hook
// output: Regression coverage that fresh Windows installs provision Git for Windows automatically
// pos: Windows installer dependency contract for the desktop app

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'

const rootDir = join(import.meta.dir, '..', '..')

function readRepoFile(path: string): string {
  return readFileSync(join(rootDir, path), 'utf8')
}

describe('Windows Git installer contract', () => {
  test('fresh per-user installs provision Git for Windows through WinGet', () => {
    const config = yaml.load(readRepoFile('apps/electron/electron-builder.yml')) as {
      nsis?: { include?: string; perMachine?: boolean }
    }

    expect(config.nsis?.perMachine).toBe(false)
    expect(config.nsis?.include).toBe('build/installer.nsh')

    const installer = readRepoFile('apps/electron/build/installer.nsh')
    expect(installer).toContain('!macro customInstall')
    expect(installer).toContain('${ifNot} ${isUpdated}')
    expect(installer).toContain('SearchPath $0 "winget.exe"')
    expect(installer).toContain('--id Git.Git --exact --source winget')
    expect(installer).toContain('--scope user --silent --disable-interactivity')
    expect(installer).toContain('--accept-source-agreements --accept-package-agreements')
  })
})
