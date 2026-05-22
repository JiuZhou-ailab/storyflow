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
