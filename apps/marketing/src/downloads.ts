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
    label: "下载 Apple Silicon 版",
    platform: "macOS",
    detail: "适用于 M 系列 Mac",
    fileName: "Storyflow-arm64.dmg",
    href: `${latestReleaseUrl}/download/Storyflow-arm64.dmg`,
  },
  {
    id: "mac-x64",
    label: "下载 Intel Mac 版",
    platform: "macOS",
    detail: "适用于 Intel Mac",
    fileName: "Storyflow-x64.dmg",
    href: `${latestReleaseUrl}/download/Storyflow-x64.dmg`,
  },
  {
    id: "windows-x64",
    label: "下载 Windows 版",
    platform: "Windows",
    detail: "适用于 Windows x64",
    fileName: "Storyflow-x64.exe",
    href: `${latestReleaseUrl}/download/Storyflow-x64.exe`,
  },
];
