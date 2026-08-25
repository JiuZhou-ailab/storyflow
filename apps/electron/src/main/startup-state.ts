// input: Electron startup status plus host platform and architecture
// output: Startup window policy and stable recovery download URL
// pos: Keeps startup failure and recovery behavior testable outside Electron runtime

import { releaseAssetFiles } from '@craft-agent/shared/release-assets'

const STABLE_DOWNLOAD_BASE_URL = 'https://story-storage.zjding.com/latest'
const PUBLIC_DOWNLOAD_PAGE_URL = 'https://story.zjding.com'

export interface StartupWindowPolicyInput {
  initSucceeded: boolean
  isHeadless: boolean
}

export function shouldCreateWindowsAfterStartup(input: StartupWindowPolicyInput): boolean {
  return input.initSucceeded && !input.isHeadless
}

export function getStartupRecoveryDownloadUrl(platform: string, arch: string): string {
  if (platform === 'darwin') {
    const fileName = arch === 'arm64'
      ? releaseAssetFiles.macArm64Dmg
      : releaseAssetFiles.macX64Dmg
    return `${STABLE_DOWNLOAD_BASE_URL}/${fileName}`
  }

  if (platform === 'win32' && arch === 'x64') {
    return `${STABLE_DOWNLOAD_BASE_URL}/${releaseAssetFiles.windowsX64Exe}`
  }

  return PUBLIC_DOWNLOAD_PAGE_URL
}
