// input: Public R2 release naming contract
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

export const defaultDownloadBaseUrl = "https://download.storyflow.ai/latest";

type ViteImportMeta = ImportMeta & {
  env?: {
    VITE_STORYFLOW_DOWNLOAD_BASE_URL?: string;
  };
};

export function normalizeDownloadBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed || defaultDownloadBaseUrl;
}

const configuredDownloadBaseUrl =
  ((import.meta as ViteImportMeta).env?.VITE_STORYFLOW_DOWNLOAD_BASE_URL ?? "").trim();

export const downloadBaseUrl = normalizeDownloadBaseUrl(
  configuredDownloadBaseUrl || defaultDownloadBaseUrl,
);

function buildDownloadUrl(fileName: string): string {
  return `${downloadBaseUrl}/${fileName}`;
}

export const downloadOptions: DownloadOption[] = [
  {
    id: "mac-arm64",
    label: "下载 Apple Silicon 版",
    platform: "macOS",
    detail: "适用于 M 系列 Mac",
    fileName: "Storyflow-arm64.dmg",
    href: buildDownloadUrl("Storyflow-arm64.dmg"),
  },
  {
    id: "mac-x64",
    label: "下载 Intel Mac 版",
    platform: "macOS",
    detail: "适用于 Intel Mac",
    fileName: "Storyflow-x64.dmg",
    href: buildDownloadUrl("Storyflow-x64.dmg"),
  },
  {
    id: "windows-x64",
    label: "下载 Windows 版",
    platform: "Windows",
    detail: "适用于 Windows x64",
    fileName: "Storyflow-x64.exe",
    href: buildDownloadUrl("Storyflow-x64.exe"),
  },
];

export const updateManifestUrls = {
  macOS: buildDownloadUrl("latest-mac.yml"),
  Windows: buildDownloadUrl("latest.yml"),
} as const;
