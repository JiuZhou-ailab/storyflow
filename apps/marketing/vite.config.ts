// input: Marketing React app source
// output: Static landing-page build served from apps/marketing/dist
// pos: Vite configuration for Storyflow public website

import { resolve } from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  base: "/",
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      react: resolve(__dirname, "../../node_modules/react"),
      "react-dom": resolve(__dirname, "../../node_modules/react-dom"),
    },
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  optimizeDeps: {
    include: ["react", "react-dom", "lucide-react"],
  },
  server: {
    port: 5176,
    open: false,
  },
  preview: {
    port: 4176,
  },
});
