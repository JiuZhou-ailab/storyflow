// input: Workspace package manifests, the root version, and optional RELEASE_VERSION
// output: Failing or passing version consistency status for release gates
// pos: Root release preflight guard before validation and packaging

import { existsSync, readdirSync, readFileSync } from "fs";
import { join, relative } from "path";

interface PackageManifest {
  name?: string;
  version?: string;
}

const rootDir = join(import.meta.dir, "..");
const rootPackagePath = join(rootDir, "package.json");
const versionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function readPackageJson(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, "utf8")) as PackageManifest;
}

function workspacePackagePaths(scopeDir: string): string[] {
  const absoluteScopeDir = join(rootDir, scopeDir);
  if (!existsSync(absoluteScopeDir)) return [];

  return readdirSync(absoluteScopeDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(absoluteScopeDir, entry.name, "package.json"))
    .filter((path) => existsSync(path));
}

const packagePaths = [
  rootPackagePath,
  ...workspacePackagePaths("apps"),
  ...workspacePackagePaths("packages"),
];

const rootManifest = readPackageJson(rootPackagePath);
const rootVersion = rootManifest.version;
const releaseVersion = process.env.RELEASE_VERSION?.trim().replace(/^v/, "");

if (!rootVersion || !versionPattern.test(rootVersion)) {
  console.error(`Invalid root package version: ${rootVersion ?? "(missing)"}`);
  process.exit(1);
}

if (releaseVersion && (!versionPattern.test(releaseVersion) || releaseVersion !== rootVersion)) {
  console.error(`Release version ${releaseVersion} does not match package version ${rootVersion}.`);
  process.exit(1);
}

const mismatches: string[] = [];

for (const packagePath of packagePaths) {
  const manifest = readPackageJson(packagePath);
  const version = manifest.version;
  if (version !== rootVersion) {
    const label = manifest.name ?? relative(rootDir, packagePath);
    mismatches.push(`${label}: ${version ?? "(missing)"} !== ${rootVersion}`);
  }
}

if (mismatches.length > 0) {
  console.error("Workspace package versions are not aligned:");
  for (const mismatch of mismatches) {
    console.error(`- ${mismatch}`);
  }
  process.exit(1);
}

console.log(`All ${packagePaths.length} package versions are aligned at ${rootVersion}.`);
