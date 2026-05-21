# Marketing

Storyflow public landing page and release-download entry.

## Downloads

Download buttons point at `https://story.zjding.com/latest` by default. Override the
base URL at build time with `VITE_STORYFLOW_DOWNLOAD_BASE_URL` when testing another R2
custom domain or prefix.

## Files

- `index.html` - Vite HTML shell.
- `src/` - React landing page, download metadata, styles, and tests.
- `tsconfig.json` - TypeScript checks for the marketing app.
- `vite.config.ts` - Vite build and preview configuration.
