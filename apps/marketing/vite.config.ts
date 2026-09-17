// input: Marketing React app source and prebuilt product demo
// output: Static landing build and demo directory-index serving during development
// pos: Vite configuration for the marketing website

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { embedReleaseNotes } from "./release-notes";

const appDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), { name: "release-notes", transformIndexHtml: (html) => embedReleaseNotes(html) }, {
    name: "demo-directory-index",
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        // Vite's dev SPA fallback otherwise returns the landing page inside itself.
        if (request.url?.split("?")[0] === "/demo/") request.url = request.url.replace("/demo/", "/demo/index.html");
        next();
      });
    },
  }],
  root: appDir,
  base: "./",
  resolve: {
    alias: {
      "@storyflow/release-assets": resolve(appDir, "../../packages/shared/src/release-assets.ts"),
      "@": resolve(appDir, "./src"),
      react: resolve(appDir, "../../node_modules/react"),
      "react-dom": resolve(appDir, "../../node_modules/react-dom"),
    },
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  optimizeDeps: {
    include: ["react", "react-dom"],
  },
  server: {
    port: 5176,
    open: false,
  },
  preview: {
    port: 4176,
  },
});
