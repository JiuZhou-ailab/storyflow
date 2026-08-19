# input: A read-only MySQL cursor over source-specific crawler tables
# output: Normalized source capabilities, rankings, manifests, and bounded video assets
# pos: Anti-corruption layer isolating crawler schemas from the stable Catalog API

from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any

from catalog_domain import (
    media_coverage,
    nonnegative_int,
    parse_week,
    positive_int,
    ranking_entry,
    ranking_snapshot,
    series_record,
    video_asset,
)

SOURCE_DEFINITIONS: dict[str, dict[str, object]] = {
    "hongguo": {
        "displayName": "红果",
        "defaultRankingKind": "current_hot",
        "rankingKinds": ["current_hot"],
        "supportsHistory": False,
        "supportsManifest": True,
    },
    "goodshort": {
        "displayName": "GoodShort",
        "defaultRankingKind": "platform_daily",
        "rankingKinds": ["platform_daily"],
        "supportsHistory": False,
        "supportsManifest": False,
    },
    "reelshort": {
        "displayName": "ReelShort",
        "defaultRankingKind": "platform_daily",
        "rankingKinds": ["platform_daily"],
        "supportsHistory": False,
        "supportsManifest": False,
    },
    "dataeye": {
        "displayName": "DataEye",
        "defaultRankingKind": "weekly_hot",
        "rankingKinds": ["weekly_hot", "weekly_rank"],
        "supportsHistory": True,
        "supportsManifest": False,
    },
}

VIDEO_SOURCE_DEFINITIONS: dict[str, dict[str, object]] = {
    "hongguo": {"displayName": "红果", "contentKind": "episode"},
    "dramabox": {"displayName": "DramaBox", "contentKind": "episode"},
    "goodshort": {"displayName": "GoodShort", "contentKind": "episode"},
    "reelshort": {"displayName": "ReelShort Web", "contentKind": "episode"},
    "reelshort-app": {
        "displayName": "ReelShort App",
        "contentKind": "episode",
    },
    "dataeye": {"displayName": "DataEye", "contentKind": "creative"},
}

HONGGUO_RANKINGS_SQL = """
WITH available AS (
  SELECT
    CAST(series_id AS CHAR) AS series_id,
    COUNT(DISTINCT vid_index) AS playable_episode_count,
    MIN(vid_index) AS first_episode,
    MAX(vid_index) AS last_episode
  FROM hongguo_video_download_record
  WHERE oss_url LIKE 'https://%' AND vid_index > 0
  GROUP BY CAST(series_id AS CHAR)
)
SELECT
  COALESCE(NULLIF(d.series_id_str, ''), CAST(d.series_id AS CHAR)) AS series_id,
  d.series_title,
  COALESCE(JSON_LENGTH(d.video_list), NULLIF(d.episode_total_cnt, 0)) AS episode_count,
  d.hot_score,
  d.series_play_cnt,
  d.followed_cnt,
  d.digg_cnt,
  d.update_time,
  COALESCE(a.playable_episode_count, 0) AS playable_episode_count,
  a.first_episode,
  a.last_episode
FROM hongguo_video_detail_episode_list d
LEFT JOIN available a
  ON COALESCE(NULLIF(d.series_id_str, ''), CAST(d.series_id AS CHAR)) COLLATE utf8mb4_bin
   = a.series_id COLLATE utf8mb4_bin
WHERE d.hot_score > 0
ORDER BY d.hot_score DESC, series_id
"""

HONGGUO_COMPLETE_SERIES_SQL = """
WITH expected AS (
  SELECT
    COALESCE(NULLIF(series_id_str, ''), CAST(series_id AS CHAR)) AS series_id,
    MAX(NULLIF(series_title, '')) AS title,
    COALESCE(
      MAX(JSON_LENGTH(video_list)),
      MAX(NULLIF(episode_total_cnt, 0))
    ) AS expected_episode_count
  FROM hongguo_video_detail_episode_list
  GROUP BY COALESCE(NULLIF(series_id_str, ''), CAST(series_id AS CHAR))
), available AS (
  SELECT
    CAST(series_id AS CHAR) AS series_id,
    MAX(NULLIF(series_title, '')) AS title,
    COUNT(DISTINCT vid_index) AS available_episode_count,
    MIN(vid_index) AS first_episode,
    MAX(vid_index) AS last_episode
  FROM hongguo_video_download_record
  WHERE oss_url LIKE 'https://%' AND vid_index > 0
  GROUP BY CAST(series_id AS CHAR)
)
SELECT
  available.series_id,
  COALESCE(expected.title, available.title, available.series_id) AS title,
  expected.expected_episode_count AS episode_count
FROM available
JOIN expected
  ON expected.series_id COLLATE utf8mb4_bin = available.series_id COLLATE utf8mb4_bin
WHERE expected.expected_episode_count > 0
  AND available.first_episode = 1
  AND available.last_episode = expected.expected_episode_count
  AND available.available_episode_count = expected.expected_episode_count
ORDER BY title, available.series_id
"""

GOODSHORT_RANKINGS_SQL = """
WITH episodes AS (
  SELECT
    book_id,
    COUNT(DISTINCT chapter_id) AS metadata_episode_count,
    COUNT(DISTINCT CASE WHEN video_url LIKE 'https://%%' THEN chapter_id END) AS playable_episode_count,
    MIN(serial_number) AS first_episode,
    MAX(serial_number) AS last_episode
  FROM goodshort_episode_detail
  GROUP BY book_id
)
SELECT
  h.book_id,
  h.book_name,
  h.rank AS ranking,
  h.chapter_count,
  h.view_count,
  h.collect_count,
  h.follow_count,
  h.like_count,
  h.praise_count,
  h.update_time,
  COALESCE(e.metadata_episode_count, 0) AS metadata_episode_count,
  COALESCE(e.playable_episode_count, 0) AS playable_episode_count,
  e.first_episode,
  e.last_episode
FROM goodshort_hot_list_top10 h
LEFT JOIN episodes e ON e.book_id = h.book_id
WHERE h.run_date = %s
ORDER BY h.rank, h.book_id
"""

REELSHORT_RANKINGS_SQL = """
WITH episodes AS (
  SELECT
    book_id,
    COUNT(DISTINCT chapter_id) AS metadata_episode_count,
    COUNT(DISTINCT CASE WHEN video_url LIKE 'https://%%' THEN chapter_id END) AS playable_episode_count,
    MIN(serial_number) AS first_episode,
    MAX(serial_number) AS last_episode
  FROM reelshort_episode_detail
  GROUP BY book_id
)
SELECT
  h.book_id,
  h.title,
  h.rank AS ranking,
  h.chapter_count,
  h.read_count,
  h.collect_count,
  h.like_count,
  h.updated_at,
  COALESCE(e.metadata_episode_count, 0) AS metadata_episode_count,
  COALESCE(e.playable_episode_count, 0) AS playable_episode_count,
  e.first_episode,
  e.last_episode
FROM reelshort_daily_top_movies h
LEFT JOIN episodes e ON e.book_id = h.book_id
WHERE h.run_date = %s
ORDER BY h.rank, h.book_id
"""

DATAEYE_HOT_SQL = """
SELECT
  playlet_id,
  playlet_name,
  ranking,
  consume_num,
  total_consume_num,
  update_time
FROM dataeye_playlet_hot_list
WHERE week = %s
ORDER BY ranking, playlet_id
"""

DATAEYE_RANK_SQL = """
SELECT
  playlet_id,
  playlet_name,
  ranking,
  material_cnt,
  release_day,
  update_time
FROM dataeye_playlet_rank_list
WHERE week = %s
ORDER BY ranking, playlet_id
"""

DATAEYE_SNAPSHOT_SQL: dict[str, str] = {
    "weekly_hot": """
SELECT week, MAX(update_time) AS observed_at
FROM dataeye_playlet_hot_list
GROUP BY week
ORDER BY week DESC
""",
    "weekly_rank": """
SELECT week, MAX(update_time) AS observed_at
FROM dataeye_playlet_rank_list
GROUP BY week
ORDER BY week DESC
""",
}

HONGGUO_DETAIL_SQL = """
SELECT
  COALESCE(NULLIF(series_id_str, ''), CAST(series_id AS CHAR)) AS series_id,
  series_title,
  COALESCE(JSON_LENGTH(video_list), NULLIF(episode_total_cnt, 0)) AS episode_count
FROM hongguo_video_detail_episode_list
WHERE COALESCE(NULLIF(series_id_str, ''), CAST(series_id AS CHAR)) COLLATE utf8mb4_bin = %s
"""

HONGGUO_EPISODES_SQL = """
SELECT series_id, vid_index, vid, oss_url
FROM hongguo_video_download_record
WHERE series_id COLLATE utf8mb4_bin = %s AND oss_url LIKE 'https://%%' AND vid_index > 0
ORDER BY vid_index, update_time DESC, id DESC
"""

VIDEO_ASSET_SQL: dict[str, str] = {
    "hongguo": """
SELECT
  CAST(series_id AS CHAR) AS source_series_id,
  COALESCE(NULLIF(series_title, ''), CAST(series_id AS CHAR)) AS series_title,
  vid AS source_asset_id,
  vid_index AS episode_number,
  NULLIF(episode_title, '') AS asset_title,
  COALESCE(NULLIF(oss_url, ''), NULLIF(main_url, '')) AS playback_url,
  COALESCE(NULLIF(oss_url, ''), NULLIF(main_url, '')) AS download_url,
  CASE WHEN oss_url LIKE 'https://%%' THEN 'oss_file' ELSE 'signed_file' END AS delivery,
  'video/mp4' AS mime_type,
  update_time AS observed_at,
  NULL AS media_variants
FROM hongguo_video_download_record
WHERE COALESCE(NULLIF(oss_url, ''), NULLIF(main_url, '')) LIKE 'https://%%'
""",
    "dramabox": """
SELECT
  book_id AS source_series_id,
  COALESCE(NULLIF(book_name, ''), book_id) AS series_title,
  chapter_id AS source_asset_id,
  chapter_index + 1 AS episode_number,
  NULLIF(chapter_name, '') AS asset_title,
  oss_url AS playback_url,
  oss_url AS download_url,
  'oss_file' AS delivery,
  'video/mp4' AS mime_type,
  update_time AS observed_at,
  NULL AS media_variants
FROM dramabox_episode_detail
WHERE oss_url LIKE 'https://%%'
""",
    "goodshort": """
SELECT
  book_id AS source_series_id,
  COALESCE(NULLIF(book_name, ''), book_id) AS series_title,
  CAST(chapter_id AS CHAR) AS source_asset_id,
  serial_number AS episode_number,
  COALESCE(NULLIF(chapter_name, ''), NULLIF(seo_chapter_name, '')) AS asset_title,
  video_url AS playback_url,
  NULL AS download_url,
  'signed_hls' AS delivery,
  'application/vnd.apple.mpegurl' AS mime_type,
  update_time AS observed_at,
  NULL AS media_variants
FROM goodshort_episode_detail
WHERE video_url LIKE 'https://%%'
""",
    "reelshort": """
SELECT
  book_id AS source_series_id,
  title AS series_title,
  chapter_id AS source_asset_id,
  serial_number + 1 AS episode_number,
  NULLIF(episode, '') AS asset_title,
  video_url AS playback_url,
  NULL AS download_url,
  'hls' AS delivery,
  'application/vnd.apple.mpegurl' AS mime_type,
  updated_at AS observed_at,
  NULL AS media_variants
FROM reelshort_episode_detail
WHERE video_url LIKE 'https://%%'
""",
    "reelshort-app": """
SELECT
  episode.book_id AS source_series_id,
  COALESCE(NULLIF(book.book_title, ''), episode.book_id) AS series_title,
  episode.chapter_id AS source_asset_id,
  episode.serial_number AS episode_number,
  NULLIF(episode.chapter_name, '') AS asset_title,
  NULL AS playback_url,
  NULL AS download_url,
  'hls' AS delivery,
  'application/vnd.apple.mpegurl' AS mime_type,
  episode.updated_at AS observed_at,
  episode.decoded_play_info AS media_variants
FROM reelshort_app_episode_detail episode
LEFT JOIN reelshort_app_book_detail book ON book.book_id = episode.book_id
WHERE JSON_LENGTH(episode.decoded_play_info) > 0
""",
    "dataeye": """
SELECT
  COALESCE(CAST(creative.playlet_id AS CHAR), CONCAT('creative-', creative.pk_id)) AS source_series_id,
  COALESCE(NULLIF(creative.playlet_name, ''), CONCAT('Creative ', creative.pk_id)) AS series_title,
  CONCAT(creative.collection, ':', creative.pk_id, ':', variant.position) AS source_asset_id,
  NULL AS episode_number,
  NULLIF(creative.asset_title, '') AS asset_title,
  variant.url AS playback_url,
  variant.url AS download_url,
  'https_file' AS delivery,
  'video/mp4' AS mime_type,
  creative.observed_at,
  NULL AS media_variants
FROM (
  SELECT
    'weekly-rank' AS collection,
    pk_id,
    COALESCE(playlet_id, rank_playlet_id) AS playlet_id,
    COALESCE(NULLIF(playlet_name, ''), NULLIF(rank_playlet_name, '')) AS playlet_name,
    COALESCE(NULLIF(title1, ''), NULLIF(marketing_keyword, '')) AS asset_title,
    video_list,
    update_time AS observed_at
  FROM dataeye_playlet_creative_list
  UNION ALL
  SELECT
    'weekly-hot' AS collection,
    pk_id,
    COALESCE(playlet_id, hot_playlet_id) AS playlet_id,
    COALESCE(NULLIF(playlet_name, ''), NULLIF(hot_playlet_name, '')) AS playlet_name,
    COALESCE(NULLIF(title1, ''), NULLIF(marketing_keyword, '')) AS asset_title,
    video_list,
    update_time AS observed_at
  FROM dataeye_playlet_hot_creative_list
) creative
JOIN JSON_TABLE(
  creative.video_list,
  '$[*]' COLUMNS(
    position FOR ORDINALITY,
    url VARCHAR(2048) PATH '$'
  )
) variant ON TRUE
WHERE variant.url LIKE 'https://%%.mp4%%'
""",
}


def list_sources() -> list[dict[str, object]]:
    return [
        {"id": source, **definition}
        for source, definition in SOURCE_DEFINITIONS.items()
    ]


def list_video_sources() -> list[dict[str, object]]:
    return [
        {"id": source, **definition}
        for source, definition in VIDEO_SOURCE_DEFINITIONS.items()
    ]


def query_video_assets(
    cursor: Any,
    source: str,
    search: str,
    source_series_id: str,
    limit: int,
    offset: int,
) -> dict[str, object]:
    definition = VIDEO_SOURCE_DEFINITIONS.get(source)
    if definition is None:
        raise ValueError("unsupported_video_source")
    base = VIDEO_ASSET_SQL[source]
    where = """
WHERE (%s = '' OR BINARY source_series_id = BINARY %s)
  AND (
    %s = ''
    OR INSTR(LOWER(CONCAT_WS(' ', series_title, asset_title)), LOWER(%s)) > 0
  )
"""
    params = (source_series_id, source_series_id, search, search)
    cursor.execute(
        f"""
WITH assets AS ({base})
SELECT assets.*, COUNT(*) OVER() AS total
FROM assets
{where}
ORDER BY series_title, COALESCE(episode_number, 2147483647), source_asset_id
LIMIT %s OFFSET %s
""",
        (*params, limit, offset),
    )
    rows = cursor.fetchall()
    total = int(rows[0]["total"]) if rows else 0
    if not rows and offset:
        cursor.execute(
            f"WITH assets AS ({base}) SELECT COUNT(*) AS total FROM assets {where}",
            params,
        )
        total = int(cursor.fetchone()["total"])
    assets = [
        asset
        for row in rows
        if (asset := _video_asset_from_row(source, definition, row)) is not None
    ]
    return {
        "source": source,
        "total": total,
        "offset": offset,
        "limit": limit,
        "nextOffset": offset + len(assets) if offset + len(assets) < total else None,
        "assets": assets,
    }


def list_complete_hongguo_series(cursor: Any) -> list[dict[str, object]]:
    cursor.execute(HONGGUO_COMPLETE_SERIES_SQL)
    return [
        {
            "id": str(row["series_id"]),
            "title": str(row["title"]),
            "episodeCount": int(row["episode_count"]),
        }
        for row in cursor.fetchall()
    ]


def default_ranking_kind(source: str) -> str:
    definition = _definition(source)
    return str(definition["defaultRankingKind"])


def list_snapshots(
    cursor: Any, source: str, ranking_kind: str
) -> list[dict[str, object]]:
    _assert_ranking_kind(source, ranking_kind)
    if source == "hongguo":
        cursor.execute(
            "SELECT MAX(update_time) AS observed_at FROM hongguo_video_detail_episode_list"
        )
        row = cursor.fetchone()
        return _dated_snapshots(
            source, ranking_kind, [row] if row else [], "observed_at"
        )
    if source == "goodshort":
        cursor.execute(
            "SELECT MAX(run_date) AS period, MAX(update_time) AS observed_at FROM goodshort_hot_list_top10"
        )
        row = cursor.fetchone()
        return _dated_snapshots(source, ranking_kind, [row] if row else [], "period")
    if source == "reelshort":
        cursor.execute(
            "SELECT MAX(run_date) AS period, MAX(updated_at) AS observed_at FROM reelshort_daily_top_movies"
        )
        row = cursor.fetchone()
        return _dated_snapshots(source, ranking_kind, [row] if row else [], "period")

    cursor.execute(DATAEYE_SNAPSHOT_SQL[ranking_kind])
    snapshots: list[dict[str, object]] = []
    for row in cursor.fetchall():
        week = parse_week(str(row.get("week") or ""))
        if week:
            snapshots.append(
                ranking_snapshot(
                    source, ranking_kind, week[0], week[1], row.get("observed_at")
                )
            )
    return snapshots


def list_rankings(
    cursor: Any,
    source: str,
    ranking_kind: str,
    snapshot: dict[str, object],
) -> list[dict[str, object]]:
    _assert_ranking_kind(source, ranking_kind)
    if source == "hongguo":
        cursor.execute(HONGGUO_RANKINGS_SQL)
        return _hongguo_entries(cursor.fetchall())
    if source == "goodshort":
        cursor.execute(GOODSHORT_RANKINGS_SQL, (snapshot["periodStart"],))
        return _goodshort_entries(cursor.fetchall())
    if source == "reelshort":
        cursor.execute(REELSHORT_RANKINGS_SQL, (snapshot["periodStart"],))
        return _reelshort_entries(cursor.fetchall())

    week = f"{snapshot['periodStart']} ~ {snapshot['periodEnd']}"
    if ranking_kind == "weekly_hot":
        cursor.execute(DATAEYE_HOT_SQL, (week,))
        return _dataeye_entries(cursor.fetchall(), True)
    cursor.execute(DATAEYE_RANK_SQL, (week,))
    return _dataeye_entries(cursor.fetchall(), False)


def get_manifest(cursor: Any, source: str, source_id: str) -> dict[str, object] | None:
    _definition(source)
    if source != "hongguo":
        ranking_kind = default_ranking_kind(source)
        snapshots = list_snapshots(cursor, source, ranking_kind)
        if not snapshots:
            return None
        entry = next(
            (
                item
                for item in list_rankings(cursor, source, ranking_kind, snapshots[0])
                if item["series"]["sourceSeriesId"] == source_id  # type: ignore[index]
            ),
            None,
        )
        if entry is None:
            return None
        return {"series": entry["series"], "media": entry["media"], "episodes": []}

    cursor.execute(HONGGUO_DETAIL_SQL, (source_id,))
    details = cursor.fetchall()
    if not details:
        return None
    declared = max(
        (positive_int(row.get("episode_count")) or 0 for row in details), default=0
    )
    title = next(
        (
            str(row["series_title"]).strip()
            for row in details
            if row.get("series_title")
        ),
        source_id,
    )
    cursor.execute(HONGGUO_EPISODES_SQL, (source_id,))
    rows = cursor.fetchall()
    deduped: dict[int, dict[str, object]] = {}
    for row in rows:
        episode = positive_int(row.get("vid_index"))
        if episode is not None and episode not in deduped:
            deduped[episode] = row
    ordered = [deduped[number] for number in sorted(deduped)]
    contiguous = bool(declared) and list(deduped) == list(range(1, declared + 1))
    media = media_coverage(
        declared, declared, len(ordered), len(ordered), contiguous, "oss_file"
    )
    series = series_record(source, source_id, title, declared)
    if series is None:
        return None
    episodes = (
        [
            {
                "episode": int(row["vid_index"]),
                "sourceId": str(row["vid"]),
                "downloadUrl": str(row["oss_url"]),
                "mimeType": "video/mp4",
            }
            for row in ordered
        ]
        if media["conversionReady"] is True
        else []
    )
    return {"series": series, "media": media, "episodes": episodes}


def _video_asset_from_row(
    source: str,
    definition: dict[str, object],
    row: dict[str, object],
) -> dict[str, object] | None:
    variants = _reelshort_app_variants(row.get("media_variants"))
    playback_url = row.get("playback_url")
    if variants:
        playback_url = variants[0]["playbackUrl"]
    return video_asset(
        source,
        row.get("source_series_id"),
        row.get("series_title"),
        row.get("source_asset_id"),
        row.get("asset_title"),
        str(definition["contentKind"]),
        row.get("episode_number"),
        str(row.get("delivery") or ""),
        str(row.get("mime_type") or ""),
        playback_url,
        row.get("download_url"),
        row.get("observed_at"),
        variants,
    )


def _reelshort_app_variants(value: object) -> list[dict[str, object]]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return []
    if not isinstance(value, list):
        return []
    variants = []
    for item in value:
        if not isinstance(item, dict):
            continue
        url = str(item.get("PlayURL") or "").strip()
        if not url.startswith("https://"):
            continue
        quality = nonnegative_int(item.get("Dpi"))
        variants.append(
            {
                "quality": f"{quality}p" if quality else "auto",
                "bitrate": str(item.get("Bitrate") or "").strip() or None,
                "codec": str(item.get("Encode") or "").strip() or None,
                "playbackUrl": url,
            }
        )
    return sorted(
        variants,
        key=lambda item: nonnegative_int(str(item["quality"]).removesuffix("p")),
        reverse=True,
    )


def _definition(source: str) -> dict[str, object]:
    definition = SOURCE_DEFINITIONS.get(source)
    if definition is None:
        raise ValueError("unsupported_source")
    return definition


def _assert_ranking_kind(source: str, ranking_kind: str) -> None:
    definition = _definition(source)
    if ranking_kind not in definition["rankingKinds"]:
        raise ValueError("unsupported_ranking_kind")


def _dated_snapshots(
    source: str,
    ranking_kind: str,
    rows: list[dict[str, object]],
    period_column: str,
) -> list[dict[str, object]]:
    snapshots: list[dict[str, object]] = []
    for row in rows:
        observed = row.get("observed_at")
        period = row.get(period_column)
        if period_column == "observed_at" and isinstance(observed, datetime):
            period = observed.date()
        if isinstance(period, datetime):
            period = period.date()
        if isinstance(period, date):
            value = period.isoformat()
            snapshots.append(
                ranking_snapshot(source, ranking_kind, value, value, observed)
            )
    return snapshots


def _is_contiguous(
    first: object, last: object, count: int, declared: int | None
) -> bool:
    if declared is None or count != declared:
        return False
    start = int(first) if first is not None else -1
    end = int(last) if last is not None else -1
    return start in {0, 1} and end == start + declared - 1


def _hongguo_entries(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    entries: list[dict[str, object]] = []
    seen: set[str] = set()
    for row in rows:
        declared = positive_int(row.get("episode_count"))
        playable = int(row.get("playable_episode_count") or 0)
        series = series_record(
            "hongguo", row.get("series_id"), row.get("series_title"), declared
        )
        if series is None or series["sourceSeriesId"] in seen:
            continue
        media = media_coverage(
            declared,
            declared,
            playable,
            playable,
            _is_contiguous(
                row.get("first_episode"), row.get("last_episode"), playable, declared
            ),
            "oss_file",
        )
        entry = ranking_entry(
            series,
            len(entries) + 1,
            {
                "hotScore": row.get("hot_score"),
                "playCount": row.get("series_play_cnt"),
                "followCount": row.get("followed_cnt"),
                "diggCount": row.get("digg_cnt"),
            },
            media,
            row.get("update_time"),
        )
        if entry:
            seen.add(str(series["sourceSeriesId"]))
            entries.append(entry)
    return entries


def _goodshort_entries(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    entries: list[dict[str, object]] = []
    for row in rows:
        declared = positive_int(row.get("chapter_count"))
        metadata = int(row.get("metadata_episode_count") or 0)
        playable = int(row.get("playable_episode_count") or 0)
        series = series_record(
            "goodshort", row.get("book_id"), row.get("book_name"), declared
        )
        if series is None:
            continue
        media = media_coverage(
            declared,
            metadata,
            playable,
            0,
            _is_contiguous(
                row.get("first_episode"), row.get("last_episode"), metadata, declared
            ),
            "signed_hls" if playable else "none",
        )
        entry = ranking_entry(
            series,
            row.get("ranking"),
            {
                "viewCount": row.get("view_count"),
                "collectCount": row.get("collect_count"),
                "followCount": row.get("follow_count"),
                "likeCount": row.get("like_count"),
                "praiseCount": row.get("praise_count"),
            },
            media,
            row.get("update_time"),
        )
        if entry:
            entries.append(entry)
    return entries


def _reelshort_entries(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    entries: list[dict[str, object]] = []
    for row in rows:
        declared = positive_int(row.get("chapter_count"))
        metadata = int(row.get("metadata_episode_count") or 0)
        playable = int(row.get("playable_episode_count") or 0)
        series = series_record(
            "reelshort", row.get("book_id"), row.get("title"), declared
        )
        if series is None:
            continue
        media = media_coverage(
            declared,
            metadata,
            playable,
            0,
            _is_contiguous(
                row.get("first_episode"), row.get("last_episode"), metadata, declared
            ),
            "signed_hls" if playable else "none",
        )
        entry = ranking_entry(
            series,
            row.get("ranking"),
            {
                "readCount": row.get("read_count"),
                "collectCount": row.get("collect_count"),
                "likeCount": row.get("like_count"),
            },
            media,
            row.get("updated_at"),
        )
        if entry:
            entries.append(entry)
    return entries


def _dataeye_entries(
    rows: list[dict[str, object]], hot: bool
) -> list[dict[str, object]]:
    entries: list[dict[str, object]] = []
    for row in rows:
        series = series_record(
            "dataeye", row.get("playlet_id"), row.get("playlet_name"), None
        )
        if series is None:
            continue
        metrics = (
            {
                "consumeCount": row.get("consume_num"),
                "totalConsumeCount": row.get("total_consume_num"),
            }
            if hot
            else {
                "materialCount": row.get("material_cnt"),
                "releaseDay": row.get("release_day"),
            }
        )
        entry = ranking_entry(
            series,
            row.get("ranking"),
            metrics,
            media_coverage(None, 0, 0, 0, False, "none"),
            row.get("update_time"),
        )
        if entry:
            entries.append(entry)
    return entries


def self_test() -> None:
    assert default_ranking_kind("goodshort") == "platform_daily"
    assert [item["id"] for item in list_video_sources()] == [
        "hongguo",
        "dramabox",
        "goodshort",
        "reelshort",
        "reelshort-app",
        "dataeye",
    ]
    variants = _reelshort_app_variants(
        [
            {
                "Dpi": 540,
                "Encode": "H264",
                "Bitrate": "800",
                "PlayURL": "https://example.com/540.m3u8",
            },
            {
                "Dpi": 720,
                "Encode": "H264",
                "Bitrate": "1200",
                "PlayURL": "https://example.com/720.m3u8",
            },
        ]
    )
    assert [item["quality"] for item in variants] == ["720p", "540p"]
    try:
        default_ranking_kind("missing")
    except ValueError as error:
        assert str(error) == "unsupported_source"
    else:
        raise AssertionError("unknown source must fail")
    entries = _goodshort_entries(
        [
            {
                "book_id": "1",
                "book_name": "测试剧",
                "ranking": 1,
                "chapter_count": 80,
                "metadata_episode_count": 8,
                "playable_episode_count": 8,
                "first_episode": 1,
                "last_episode": 8,
                "view_count": 99,
                "update_time": "2026-08-01 08:00:00",
            }
        ]
    )
    assert entries[0]["series"]["key"] == "goodshort:1"  # type: ignore[index]
    assert entries[0]["media"]["conversionReady"] is False  # type: ignore[index]
