// input: Electron packaging state, process paths, platform, and architecture
// output: Runtime paths for bundled CLI tools, docs, and vendored executables
// pos: Pure path resolver for main-process startup environment configuration

import { posix, win32 } from 'path'

export interface ElectronRuntimePathInput {
  isPackaged: boolean
  appPath: string
  resourcesPath?: string
  dirname: string
  cwd: string
  platform: NodeJS.Platform
  arch: string
}

export interface ElectronRuntimePaths {
  appRoot: string
  resourcesBase: string
  uvPlatformDir: string
  uvBinary: string
  binDir: string
  scriptsDir: string
  bunBinary: string
  commandsEntry: string
  cliEntry: string
  commandsDocPath: string
}

export function resolveElectronRuntimePaths(input: ElectronRuntimePathInput): ElectronRuntimePaths {
  const path = input.platform === 'win32' ? win32 : posix
  const appRoot = input.isPackaged ? input.appPath : input.cwd
  const resourcesBase = input.isPackaged ? path.join(appRoot, 'dist') : path.join(input.dirname, '..')
  const vendorBase = input.isPackaged && input.platform === 'win32' && input.resourcesPath
    ? input.resourcesPath
    : input.isPackaged
      ? appRoot
      : resourcesBase
  const platformKey = `${input.platform}-${input.arch}`
  const uvName = input.platform === 'win32' ? 'uv.exe' : 'uv'
  const bunName = input.platform === 'win32' ? 'bun.exe' : 'bun'
  const uvPlatformDir = path.join(resourcesBase, 'resources', 'bin', platformKey)
  const electronResourcesDir = input.isPackaged
    ? path.join(resourcesBase, 'resources')
    : path.join(input.cwd, 'apps', 'electron', 'resources')

  return {
    appRoot,
    resourcesBase,
    uvPlatformDir,
    uvBinary: path.join(uvPlatformDir, uvName),
    binDir: path.join(resourcesBase, 'resources', 'bin'),
    scriptsDir: path.join(resourcesBase, 'resources', 'scripts'),
    bunBinary: path.join(vendorBase, 'vendor', 'bun', bunName),
    commandsEntry: input.isPackaged
      ? path.join(appRoot, 'packages', 'craft-agents-commands', 'src', 'main.ts')
      : path.join(input.cwd, 'packages', 'craft-agents-commands', 'src', 'main.ts'),
    cliEntry: input.isPackaged
      ? path.join(appRoot, 'packages', 'craft-cli', 'src', 'cli.ts')
      : path.join(input.cwd, 'packages', 'craft-cli', 'src', 'cli.ts'),
    commandsDocPath: path.join(electronResourcesDir, 'docs', 'craft-cli.md'),
  }
}
