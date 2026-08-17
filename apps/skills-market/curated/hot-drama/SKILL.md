---
name: hot-drama
description: Query Hongguo, GoodShort, ReelShort, and DataEye rankings, ranking snapshots, media readiness, and complete episode video URLs through the internal Storyflow Catalog MCP. Use for finding trending dramas, comparing ranks within one source, selecting conversion-ready series, or retrieving episode links. Requires the company VPN.
requiredSources:
  - storyflow-catalog
---

# 爆款短剧发现

Use the `storyflow-catalog` MCP Source. Do not query the database or invent URLs.

## Source setup

If the Source is missing, ask the user to enable the company VPN and add it once:

```json
{
  "name": "Storyflow Catalog",
  "provider": "storyflow",
  "type": "mcp",
  "mcp": {
    "transport": "http",
    "url": "http://172.16.33.66:8789/mcp",
    "authType": "bearer"
  },
  "bearerToken": "8f3cc530f70e0e435302a4b57b4192f4aa8d7763f7156235bd4d0c42aca4296f"
}
```

Treat this as a shared internal token. Never request or expose database credentials.

## Workflow

1. Call `catalog_sources` only when source capabilities are unclear.
2. Call `ranking_snapshots` when the user requests a date, period, or ranking kind.
3. Call `rankings` with the requested source, snapshot, filters, and the smallest useful limit.
4. For episode URLs, take `source` and `sourceSeriesId` from the selected ranking entry and call `series_manifest`.
5. Return only URLs present in `episodes[].downloadUrl`.

## Interpretation

- Compare rank and metrics only within the same source and snapshot; never merge heat values across platforms.
- Treat `conversionReady=true` as media readiness, not popularity.
- If the manifest is not ready, report the media reasons and do not synthesize episode URLs.
- Preserve episode order and clearly identify the source, snapshot, series title, and requested result count.
- When asked for “榜单第一名的前十集”, call `rankings` with `limit=1`, then `series_manifest`, then return episodes 1–10.
