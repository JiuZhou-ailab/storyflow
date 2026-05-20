// input: Public GitHub release naming contract
// output: Typed download options for the Storyflow landing page
// pos: Single source of truth for public installer links

export type DownloadOption = {
  id: "mac-arm64" | "mac-x64" | "windows-x64";
  label: string;
  platform: string;
  detail: string;
  fileName: string;
  href: string;
};

export const repositoryUrl = "https://github.com/JiuZhou-ailab/craft-agents-oss";

export const latestReleaseUrl = `${repositoryUrl}/releases/latest`;

export const downloadOptions: DownloadOption[] = [
  {
    id: "mac-arm64",
    label: "Download for Apple Silicon",
    platform: "macOS",
    detail: "M-series Macs",
    fileName: "Storyflow-arm64.dmg",
    href: `${latestReleaseUrl}/download/Storyflow-arm64.dmg`,
  },
  {
    id: "mac-x64",
    label: "Download for Intel Mac",
    platform: "macOS",
    detail: "Intel Macs",
    fileName: "Storyflow-x64.dmg",
    href: `${latestReleaseUrl}/download/Storyflow-x64.dmg`,
  },
  {
    id: "windows-x64",
    label: "Download for Windows",
    platform: "Windows",
    detail: "Windows x64",
    fileName: "Storyflow-x64.exe",
    href: `${latestReleaseUrl}/download/Storyflow-x64.exe`,
  },
];
