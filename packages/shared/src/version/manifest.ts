import { debug } from "../utils/debug";

const GITHUB_REPOSITORY = 'JiuZhou-ailab/craft-agents-oss';
const GITHUB_RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases`;
const GITHUB_RELEASES_DOWNLOAD_URL = `https://github.com/${GITHUB_REPOSITORY}/releases/download`;

function versionFromTag(tagName: string): string {
    return tagName.startsWith('v') ? tagName.slice(1) : tagName;
}

function tagFromVersion(version: string): string {
    return version.startsWith('v') ? version : `v${version}`;
}

export async function getLatestVersion(): Promise<string | null> {
    try {
      const response = await fetch(`${GITHUB_RELEASES_API_URL}/latest`);
      const data = await response.json();
      const tagName = (data as { tag_name?: string }).tag_name;
      if (typeof tagName !== 'string') {
        debug('[manifest] Latest version is not a valid string');
        return null;
      }
      return versionFromTag(tagName);
    } catch (error) {
      debug(`[manifest] Failed to get latest version: ${error}`);
    }
    return null;
}

export async function getManifest(version: string): Promise<VersionManifest | null> {
    try {
        const url = `${GITHUB_RELEASES_DOWNLOAD_URL}/${tagFromVersion(version)}/manifest.json`;
        debug(`[manifest] Getting manifest for version: ${url}`);
        const response = await fetch(url);
        const data = await response.json();
        return data as VersionManifest;
    } catch (error) {
        debug(`[manifest] Failed to get manifest: ${error}`);
    }
    return null;
}


export interface BinaryInfo {
  url: string;
  sha256: string;
  size: number;
  filename?: string;
}

export interface VersionManifest {
  version: string;
  build_time: string;
  build_timestamp: number;
  binaries: Record<string, BinaryInfo>;
}
