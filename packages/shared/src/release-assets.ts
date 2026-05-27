// input: Stable public Storyflow release asset names
// output: Shared release asset constants for publishing and download surfaces
// pos: Public release asset naming contract

export const releaseAssetFiles = {
  macArm64Dmg: "Storyflow-arm64.dmg",
  macX64Dmg: "Storyflow-x64.dmg",
  macArm64Zip: "Storyflow-arm64.zip",
  macX64Zip: "Storyflow-x64.zip",
  windowsX64Exe: "Storyflow-x64.exe",
  macManifest: "latest-mac.yml",
  windowsManifest: "latest.yml",
  installSh: "install-app.sh",
  installPs1: "install-app.ps1",
} as const;

export const requiredPublicReleaseAssets = [
  releaseAssetFiles.macArm64Dmg,
  releaseAssetFiles.macX64Dmg,
  releaseAssetFiles.macArm64Zip,
  releaseAssetFiles.macX64Zip,
  releaseAssetFiles.windowsX64Exe,
  releaseAssetFiles.macManifest,
  releaseAssetFiles.windowsManifest,
  releaseAssetFiles.installSh,
  releaseAssetFiles.installPs1,
] as const;

export const publicInstallerAssets = [
  { id: "mac-arm64", platform: "macOS", fileName: releaseAssetFiles.macArm64Dmg },
  { id: "mac-x64", platform: "macOS", fileName: releaseAssetFiles.macX64Dmg },
  { id: "windows-x64", platform: "Windows", fileName: releaseAssetFiles.windowsX64Exe },
] as const;

export const updateManifestFiles = {
  macOS: releaseAssetFiles.macManifest,
  Windows: releaseAssetFiles.windowsManifest,
} as const;

export type PublicInstallerAsset = (typeof publicInstallerAssets)[number];
export type PublicReleaseAssetFile = (typeof requiredPublicReleaseAssets)[number];

export function normalizeReleaseVersion(value: string): string {
  const version = value.trim().replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid release version: ${value || "(empty)"}`);
  }
  return version;
}

export function versionedInstallerFileName(
  fileName: PublicInstallerAsset["fileName"],
  releaseVersion: string,
): string {
  const version = normalizeReleaseVersion(releaseVersion);
  const match = /^Storyflow-(.+)\.(dmg|exe)$/.exec(fileName);
  if (!match) {
    throw new Error(`Unsupported installer file name: ${fileName}`);
  }
  return `Storyflow-${version}-${match[1]}.${match[2]}`;
}
