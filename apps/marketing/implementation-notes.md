# Implementation Notes

## Landing Mermaid Jump

- Changed the "看它如何工作" CTA to target a new `#how-it-works-diagram` section instead of the existing text-heavy `#workflow` section.
- Reused `beautiful-mermaid` directly in the marketing app so the diagram is generated as SVG at render time and does not introduce another charting stack.
- Kept the original workflow section intact. The new diagram is an earlier visual explanation, while the existing cards remain the longer written explanation.
- Added `beautiful-mermaid` as an explicit marketing app dependency because `App.tsx` now imports it directly.
- Adjusted the diagram grid to give the SVG more room on desktop. Mobile keeps horizontal scrolling inside the diagram frame so node labels stay readable instead of shrinking the chart too far.
- Reworked the first diagram after visual review: removed the left-text/right-diagram split, expanded the Mermaid source into a Workspace creation flow closer to the in-app reference, and centered it as a full product canvas.
- Tuned the mobile diagram width down from the desktop canvas size so the initial mobile viewport shows useful early-flow content instead of landing on an empty part of the chart.
- Unified the landing page visual width with `--landing-content-width` for hero media, diagram, text sections, screenshots, card rows, and footer. Body copy still uses `--landing-read-width` inside those sections so line length stays readable without making the whole page look ragged.
- Matched the footer's actual box width to the same content edges instead of using a full-width footer with horizontal padding.
- Split visual widths after follow-up review: `--landing-showcase-width` stays 1100px for the hero video and Mermaid canvas, while `--landing-content-width` is 896px for downstream text sections, screenshots, card rows, and footer.
- Switched default installer links to the storage hostname and copied `_redirects` into marketing builds so the legacy root-domain release paths can forward to the public R2 storage domain.
- Published the marketing build to Cloudflare Pages as the `storyflow` project and attached `story.zjding.com` as its custom domain.
- Kept R2 release assets on `story-storage.zjding.com`; `story.zjding.com/latest/*` and `/releases/*` now redirect to the storage hostname.
- Set the `story.zjding.com` DNS CNAME to DNS-only after Pages validation went active, because a manually created proxied CNAME closed HTTPS connections instead of serving the Pages route.
- Narrowed the Mermaid diagram into its own 760px canvas instead of sharing the 1100px hero showcase width, matching the generated SVG's natural size more closely.
- Replaced the one-letter context dots with full labels and short descriptions so the source strip reads as real workspace context instead of unexplained initials.
- Reworked "文档" from an outbound Feishu link into an in-site `/docs` page rendered with the landing page's visual system. The source text was pulled with `lark-cli docs +fetch`; Feishu media download was blocked by missing app scopes, so the first version uses existing Storyflow screenshots rather than remote Feishu media tokens.
- Changed marketing build and static asset references to root-relative URLs so the `/docs/` page can load JS, CSS, icons, video, and screenshots correctly from a nested route.
- Replaced the summarized `/docs/` version with the user's full ordered document text and the current chat-uploaded Electron screenshots, stored under `reference-assets/docs/`.
- The current chat payload contained nine screenshot uploads, not a separate project-switching screenshot for the "图 5：查看项目" placeholder. I kept that section as text instead of reusing or fabricating a mismatched image.
- Fixed page-switch flicker between the landing page and `/docs/` by handling same-site marketing page links in React with `history.pushState` instead of letting the browser perform a full document reload. The links still keep real `href` values so direct open, refresh, and static-host fallback continue to work.
- Kept this client-side navigation limited to `/`, `/#...`, and `/docs/`; installer downloads, media links, external links, and normal in-page hash links are intentionally left to browser defaults.
