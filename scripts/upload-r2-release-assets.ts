// input: Release artifacts downloaded from GitHub Actions and Wrangler R2 authentication
// output: Versioned and latest public Storyflow download assets in R2
// pos: Public release publisher for landing-page downloads and electron-updater manifests

import { readdirSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { requiredPublicReleaseAssets } from "@craft-agent/shared/release-assets";

type CliOptions = {
  assetsDir: string;
  tag: string;
  dryRun: boolean;
};

type UploadTarget = {
  key: string;
  cacheControl: string;
};

function usage(): string {
  return [
    "Usage: bun run scripts/upload-r2-release-assets.ts --tag=v0.9.12 --assets-dir=/path/to/assets [--dry-run]",
    "",
    "Required environment:",
    "  STORYFLOW_R2_BUCKET",
    "  Wrangler authentication via local `wrangler login` or CI CLOUDFLARE_API_TOKEN",
    "",
    "Optional environment:",
    "  STORYFLOW_R2_LATEST_PREFIX=latest",
    "  STORYFLOW_R2_RELEASE_PREFIX=releases",
    "  STORYFLOW_R2_PUBLIC_BASE_URL=https://story-storage.zjding.com",
  ].join("\n");
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    assetsDir: "",
    tag: "",
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    const [name, inlineValue] = arg.split("=", 2);
    const value = inlineValue ?? argv[index + 1];

    if (name === "--assets-dir") {
      options.assetsDir = value;
      if (!inlineValue) index += 1;
      continue;
    }

    if (name === "--tag") {
      options.tag = value;
      if (!inlineValue) index += 1;
      continue;
    }

    if (arg === "-h" || arg === "--help") {
      console.log(usage());
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.assetsDir) {
    throw new Error("Missing --assets-dir");
  }
  if (!/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(options.tag)) {
    throw new Error(`Invalid --tag value: ${options.tag || "(missing)"}`);
  }

  return options;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizePrefix(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/g, "");
}

function shouldUploadFile(fileName: string): boolean {
  return (
    /^Storyflow-.+\.(dmg|zip|exe)$/.test(fileName) ||
    /^Storyflow-.+\.(dmg|zip|exe)\.blockmap$/.test(fileName) ||
    /^latest(?:-mac(?:-(?:arm64|x64))?)?\.yml$/.test(fileName) ||
    /^install-app\.(?:sh|ps1)$/.test(fileName)
  );
}

function contentTypeFor(fileName: string): string {
  if (fileName.endsWith(".dmg")) return "application/x-apple-diskimage";
  if (fileName.endsWith(".zip")) return "application/zip";
  if (fileName.endsWith(".exe")) return "application/octet-stream";
  if (fileName.endsWith(".yml")) return "text/yaml; charset=utf-8";
  if (fileName.endsWith(".sh")) return "text/x-shellscript; charset=utf-8";
  if (fileName.endsWith(".ps1")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function wranglerCommand(): string[] {
  return (process.env.STORYFLOW_R2_WRANGLER_COMMAND ?? "bunx wrangler")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

async function putObjectWithWrangler(params: {
  bucket: string;
  filePath: string;
  target: UploadTarget;
}): Promise<void> {
  const [command, ...baseArgs] = wranglerCommand();
  if (!command) {
    throw new Error("Missing Wrangler command");
  }

  const fileName = basename(params.filePath);
  const child = Bun.spawn(
    [
      command,
      ...baseArgs,
      "r2",
      "object",
      "put",
      `${params.bucket}/${params.target.key}`,
      "--file",
      params.filePath,
      "--content-type",
      contentTypeFor(fileName),
      "--cache-control",
      params.target.cacheControl,
      "--remote",
      "--force",
    ],
    {
      cwd: process.cwd(),
      stdout: "inherit",
      stderr: "inherit",
      env: process.env,
    },
  );

  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`Wrangler upload failed for ${params.target.key} with exit code ${exitCode}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(Bun.argv.slice(2));
  const bucket = requireEnv("STORYFLOW_R2_BUCKET");
  const latestPrefix = normalizePrefix(process.env.STORYFLOW_R2_LATEST_PREFIX ?? "latest");
  const releasePrefix = normalizePrefix(process.env.STORYFLOW_R2_RELEASE_PREFIX ?? "releases");
  const publicBaseUrl = normalizeBaseUrl(
    process.env.STORYFLOW_R2_PUBLIC_BASE_URL ?? "https://story-storage.zjding.com",
  );

  const allFiles = readdirSync(options.assetsDir)
    .filter((fileName) => shouldUploadFile(fileName))
    .sort((a, b) => a.localeCompare(b));

  const missingFiles = requiredPublicReleaseAssets.filter((fileName) => !allFiles.includes(fileName));
  if (missingFiles.length > 0) {
    throw new Error(`Missing required release asset(s): ${missingFiles.join(", ")}`);
  }

  const targetsFor = (fileName: string): UploadTarget[] => [
    {
      key: `${releasePrefix}/${options.tag}/${fileName}`,
      cacheControl: "public, max-age=31536000, immutable",
    },
    {
      key: `${latestPrefix}/${fileName}`,
      cacheControl: "public, max-age=300, must-revalidate",
    },
  ];

  for (const fileName of allFiles) {
    const filePath = join(options.assetsDir, fileName);

    for (const target of targetsFor(fileName)) {
      const publicUrl = `${publicBaseUrl}/${target.key}`;
      console.log(`${options.dryRun ? "Would upload" : "Uploading"} ${relative(process.cwd(), filePath)} -> ${publicUrl}`);

      if (options.dryRun) {
        continue;
      }

      await putObjectWithWrangler({ bucket, filePath, target });
    }
  }

  console.log(`Published ${allFiles.length} asset(s) to ${publicBaseUrl}/${latestPrefix}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  console.error("");
  console.error(usage());
  process.exit(1);
});
