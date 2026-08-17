---
name: hot-drama
description: Query Hongguo, GoodShort, ReelShort, and DataEye rankings, ranking snapshots, media readiness, and complete episode video URLs through Storyflow Catalog. Use for finding trending dramas, comparing ranks within one source, selecting conversion-ready series, or retrieving episode links.
requiredSources:
  - storyflow-catalog
---

# 爆款短剧发现

Use Storyflow's built-in `storyflow-catalog` Source. Do not query the database or invent URLs.

## Prerequisite

If the Source is unavailable, ask the user to enable **Storyflow Catalog** in Sources and sign in to Storyflow. Never request or store provider tokens, MCP endpoints, or database credentials.

## Workflow

1. Call `list_sources` only when source capabilities are unclear.
2. Call `list_ranking_snapshots` when the user requests a date, period, or ranking kind.
3. Call `search_rankings` with the requested source, snapshot, filters, and the smallest useful limit.
4. For episode URLs, take `source` and `sourceSeriesId` from the selected ranking entry and call `get_conversion_manifest`.
5. Return only URLs present in `episodes[].downloadUrl`.

## Interpretation

- Compare rank and metrics only within the same source and snapshot; never merge heat values across platforms.
- Treat `conversionReady=true` as media readiness, not popularity.
- If the manifest is not ready, report the media reasons and do not synthesize episode URLs.
- Preserve episode order and clearly identify the source, snapshot, series title, and requested result count.
- When asked for “榜单第一名的前十集”, call `search_rankings` with `limit=1`, then `get_conversion_manifest`, then return episodes 1–10.
