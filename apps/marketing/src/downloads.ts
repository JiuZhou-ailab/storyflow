// input: Public R2 release naming contract
// output: Typed download options for the Storyflow landing page
// pos: Single source of truth for public installer links

import {
  publicInstallerAssets,
  versionedInstallerFileName,
  updateManifestFiles,
  type PublicInstallerAsset,
} from "@storyflow/release-assets";
import packageJson from "../package.json";

export type DownloadOption = {
  id: PublicInstallerAsset["id"];
  label: string;
  platform: PublicInstallerAsset["platform"];
  detail: string;
  fileName: PublicInstallerAsset["fileName"];
  downloadFileName: string;
  href: string;
};

export const defaultDownloadBaseUrl = "https://story-storage.zjding.com/latest";

type ViteImportMeta = ImportMeta & {
  env?: {
    VITE_STORYFLOW_DOWNLOAD_BASE_URL?: string;
    VITE_STORYFLOW_RELEASE_VERSION?: string;
  };
};

export function normalizeDownloadBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed || defaultDownloadBaseUrl;
}

const configuredDownloadBaseUrl =
  ((import.meta as ViteImportMeta).env?.VITE_STORYFLOW_DOWNLOAD_BASE_URL ?? "").trim();
const configuredReleaseVersion =
  ((import.meta as ViteImportMeta).env?.VITE_STORYFLOW_RELEASE_VERSION ?? "").trim();

export const downloadBaseUrl = normalizeDownloadBaseUrl(
  configuredDownloadBaseUrl || defaultDownloadBaseUrl,
);

function buildDownloadUrl(fileName: string): string {
  return `${downloadBaseUrl}/${fileName}`;
}

export const downloadReleaseVersion = configuredReleaseVersion || packageJson.version;

const downloadLabels: Record<
  PublicInstallerAsset["id"],
  Pick<DownloadOption, "label" | "detail">
> = {
  "mac-arm64": {
    label: "下载 Apple Silicon 版",
    detail: "适用于 M 系列 Mac",
  },
  "mac-x64": {
    label: "下载 Intel Mac 版",
    detail: "适用于 Intel Mac",
  },
  "windows-x64": {
    label: "下载 Windows 版",
    detail: "适用于 Windows x64",
  },
};

export const downloadOptions: DownloadOption[] = publicInstallerAssets.map((asset) => {
  const downloadFileName = versionedInstallerFileName(
    asset.fileName,
    downloadReleaseVersion,
  );
  return {
    ...asset,
    ...downloadLabels[asset.id],
    downloadFileName,
    href: buildDownloadUrl(downloadFileName),
  };
});

export const updateManifestUrls = {
  macOS: buildDownloadUrl(updateManifestFiles.macOS),
  Windows: buildDownloadUrl(updateManifestFiles.Windows),
} as const;
