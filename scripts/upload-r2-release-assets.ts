// input: Release artifacts downloaded from GitHub Actions and Cloudflare R2 credentials
// output: Versioned and latest public Storyflow download assets in R2
// pos: Public release publisher for landing-page downloads and electron-updater manifests

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createReadStream, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

type CliOptions = {
  assetsDir: string;
  tag: string;
  dryRun: boolean;
};

type UploadTarget = {
  key: string;
  cacheControl: string;
};

const requiredFiles = [
  "Storyflow-arm64.dmg",
  "Storyflow-x64.dmg",
  "Storyflow-arm64.zip",
  "Storyflow-x64.zip",
  "Storyflow-x64.exe",
  "latest-mac.yml",
  "latest.yml",
  "install-app.sh",
  "install-app.ps1",
] as const;

function usage(): string {
  return [
    "Usage: bun run scripts/upload-r2-release-assets.ts --tag=v0.9.12 --assets-dir=/path/to/assets [--dry-run]",
    "",
    "Required environment:",
    "  STORYFLOW_R2_BUCKET",
    "  STORYFLOW_R2_ENDPOINT",
    "  STORYFLOW_R2_ACCESS_KEY_ID",
    "  STORYFLOW_R2_SECRET_ACCESS_KEY",
    "",
    "Optional environment:",
    "  STORYFLOW_R2_LATEST_PREFIX=latest",
    "  STORYFLOW_R2_RELEASE_PREFIX=releases",
    "  STORYFLOW_R2_PUBLIC_BASE_URL=https://story.zjding.com",
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

async function main(): Promise<void> {
  const options = parseArgs(Bun.argv.slice(2));
  const bucket = requireEnv("STORYFLOW_R2_BUCKET");
  const endpoint = requireEnv("STORYFLOW_R2_ENDPOINT");
  const accessKeyId = requireEnv("STORYFLOW_R2_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("STORYFLOW_R2_SECRET_ACCESS_KEY");
  const latestPrefix = normalizePrefix(process.env.STORYFLOW_R2_LATEST_PREFIX ?? "latest");
  const releasePrefix = normalizePrefix(process.env.STORYFLOW_R2_RELEASE_PREFIX ?? "releases");
  const publicBaseUrl = normalizeBaseUrl(
    process.env.STORYFLOW_R2_PUBLIC_BASE_URL ?? "https://story.zjding.com",
  );

  const allFiles = readdirSync(options.assetsDir)
    .filter((fileName) => shouldUploadFile(fileName))
    .sort((a, b) => a.localeCompare(b));

  const missingFiles = requiredFiles.filter((fileName) => !allFiles.includes(fileName));
  if (missingFiles.length > 0) {
    throw new Error(`Missing required release asset(s): ${missingFiles.join(", ")}`);
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

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
    const stats = statSync(filePath);

    for (const target of targetsFor(fileName)) {
      const publicUrl = `${publicBaseUrl}/${target.key}`;
      console.log(`${options.dryRun ? "Would upload" : "Uploading"} ${relative(process.cwd(), filePath)} -> ${publicUrl}`);

      if (options.dryRun) {
        continue;
      }

      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: target.key,
          Body: createReadStream(filePath),
          ContentLength: stats.size,
          ContentType: contentTypeFor(basename(filePath)),
          CacheControl: target.cacheControl,
        }),
      );
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
