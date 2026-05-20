// input: apps/marketing React source and HTML shell
// output: Static production assets in apps/marketing/dist
// pos: Build script for the public Storyflow landing page

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { basename, join, relative } from "path";

const rootDir = join(import.meta.dir, "..");
const appDir = join(rootDir, "apps", "marketing");
const distDir = join(appDir, "dist");
const assetsDir = join(distDir, "assets");
const entrypoint = join(appDir, "src", "main.tsx");
const htmlPath = join(appDir, "index.html");
const faviconPath = join(appDir, "favicon.svg");

if (!existsSync(entrypoint)) {
  throw new Error(`Missing marketing entrypoint: ${relative(rootDir, entrypoint)}`);
}

rmSync(distDir, { force: true, recursive: true });
mkdirSync(assetsDir, { recursive: true });

const result = await Bun.build({
  entrypoints: [entrypoint],
  outdir: assetsDir,
  target: "browser",
  format: "esm",
  minify: true,
  sourcemap: "external",
  splitting: true,
  naming: {
    asset: "[name]-[hash].[ext]",
    chunk: "[name]-[hash].[ext]",
    entry: "[name]-[hash].[ext]",
  },
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

const jsOutput = result.outputs.find((output) => output.path.endsWith(".js"));
const cssOutput = result.outputs.find((output) => output.path.endsWith(".css"));

if (!jsOutput) {
  throw new Error("Marketing build did not emit a JavaScript entry file.");
}

const jsAsset = `./assets/${basename(jsOutput.path)}`;
const cssAsset = cssOutput ? `./assets/${basename(cssOutput.path)}` : undefined;
let html = readFileSync(htmlPath, "utf8");

html = html.replace(
  '<script type="module" src="/src/main.tsx"></script>',
  `${cssAsset ? `<link rel="stylesheet" href="${cssAsset}" />\n    ` : ""}<script type="module" src="${jsAsset}"></script>`,
);

writeFileSync(join(distDir, "index.html"), html);
if (existsSync(faviconPath)) {
  copyFileSync(faviconPath, join(distDir, "favicon.svg"));
}

console.log(`Built marketing site to ${relative(rootDir, distDir)}`);
