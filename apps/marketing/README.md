# Marketing

Storyflow landing page and release-download metadata.

The page keeps the rhythm of `https://agents.craft.do/`: centered logo hero,
three CTAs, product screenshots, FAQ, workflow sections, and compact explanatory
cards. The copy and imagery are adapted for Storyflow's writer-focused desktop
workflow.

## Downloads

Download buttons point at `https://story-storage.zjding.com/latest` by default and use
versioned installer aliases such as `Storyflow-<version>-arm64.dmg` so browser downloads
are easy to identify. Override the base URL at build time with
`VITE_STORYFLOW_DOWNLOAD_BASE_URL` when testing another R2 custom domain or prefix.
Override the displayed release alias with `VITE_STORYFLOW_RELEASE_VERSION`; otherwise
the marketing package version is used.

## Files

- `index.html` - Vite HTML shell.
- `implementation-notes.md` - Running implementation notes for current landing-page changes.
- `promo-video/` - HyperFrames product promo composition and rendered assets.
- `reference-assets/` - Local landing screenshots and visual reference assets.
- `src/` - React landing page, download metadata, styles, and tests.
- `tsconfig.json` - TypeScript checks for the marketing app.
- `vite.config.ts` - Vite build and preview configuration.
