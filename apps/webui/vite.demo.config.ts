// input: Existing browser renderer configuration and independent demo entry
// output: Self-contained static assets for the marketing iframe
// pos: Demo build reuses Web UI aliases, styles and browser shims
import { mergeConfig } from 'vite'
import { resolve } from 'node:path'
import webConfig from './vite.config'

export default mergeConfig(webConfig, {
  root: resolve(import.meta.dirname, 'src/demo'),
  base: '/demo/',
  publicDir: false,
  build: {
    outDir: resolve(import.meta.dirname, '../marketing/public/demo'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { input: resolve(import.meta.dirname, 'src/demo/index.html') },
  },
})
