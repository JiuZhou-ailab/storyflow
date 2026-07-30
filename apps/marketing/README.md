# Marketing

Storyflow landing page and release-download metadata.

The page keeps the rhythm of `https://agents.craft.do/`: centered logo hero,
three CTAs, product screenshots, FAQ, workflow sections, and compact explanatory
cards. The copy and imagery are adapted for Storyflow's writer-focused desktop
workflow.

## Downloads

Download buttons point at `https://story-storage.zjding.com/latest` by default and use
stable installer names such as `Storyflow-arm64.dmg`. Override the base URL at build
time with `VITE_STORYFLOW_DOWNLOAD_BASE_URL` when testing another R2 custom domain or
prefix. The marketing page intentionally does not know the current release version.

## Deployment

Changes to this app on `main` deploy through `.github/workflows/deploy-marketing.yml`.
The release workflow calls the same deployment after publishing release downloads.

## Files

- `index.html` - Vite HTML shell.
- `implementation-notes.md` - Running implementation notes for current landing-page changes.
- `promo-video/` - HyperFrames product promo composition and rendered assets.
- `reference-assets/` - Local landing screenshots and visual reference assets.
- `src/` - React landing page, download metadata, styles, and tests.
- `tsconfig.json` - TypeScript checks for the marketing app.
- `vite.config.ts` - Vite build and preview configuration.
