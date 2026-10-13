// input: Electron shell.openPath results wrapped by the platform factory
// output: Regression coverage for a resolved openPath error string
// pos: Guards the platform boundary that the skill editor surfaces to the user

import { describe, expect, it, mock } from 'bun:test'
import { createElectronPlatform } from '../platform'

function platform(openPath: (path: string) => Promise<string>) {
  return createElectronPlatform({
    app: { isPackaged: false, getVersion: () => '0.0.0' } as never,
    nativeImage: {} as never,
    shell: { openPath, openExternal: async () => {}, showItemInFolder: () => {} } as never,
    nativeTheme: { shouldUseDarkColors: false } as never,
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never,
    isDebugMode: false,
  })
}

describe('createElectronPlatform openPath', () => {
  it('throws the error string that shell.openPath resolves with', async () => {
    const open = platform(async () => 'Failed to open path')
    await expect(open.openPath!('/missing')).rejects.toThrow('Failed to open path')
  })

  it('resolves when shell.openPath reports success', async () => {
    const openPath = mock(async () => '')
    await expect(platform(openPath).openPath!('/ok')).resolves.toBeUndefined()
    expect(openPath).toHaveBeenCalledWith('/ok')
  })
})
