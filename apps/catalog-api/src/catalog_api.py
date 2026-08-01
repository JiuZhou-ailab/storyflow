# input: MySQL read-only credentials and origin-authenticated HTTP GET requests
# output: Complete-series manifests and current hit rankings with explicit data-quality counts
# pos: Private-network read model exposing crawler facts to the Storyflow edge gateway

from __future__ import annotations

import argparse
import hmac
import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

import pymysql
from pymysql.cursors import DictCursor

SERIES_SQL = """
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

DETAIL_BY_ID_SQL = """
SELECT
  COALESCE(NULLIF(series_id_str, ''), CAST(series_id AS CHAR)) AS normalized_series_id,
  series_title,
  episode_total_cnt,
  JSON_LENGTH(video_list) AS video_list_count
FROM hongguo_video_detail_episode_list
WHERE COALESCE(NULLIF(series_id_str, ''), CAST(series_id AS CHAR)) COLLATE utf8mb4_bin = %s
"""

DETAILS_BY_IDS_SQL = """
SELECT
  COALESCE(NULLIF(series_id_str, ''), CAST(series_id AS CHAR)) AS normalized_series_id,
  series_title,
  episode_total_cnt,
  JSON_LENGTH(video_list) AS video_list_count
FROM hongguo_video_detail_episode_list
WHERE COALESCE(NULLIF(series_id_str, ''), CAST(series_id AS CHAR)) COLLATE utf8mb4_bin IN ({placeholders})
"""

EPISODES_SQL = """
SELECT series_id, series_title, vid_index, vid, oss_url, update_time
FROM hongguo_video_download_record
WHERE series_id COLLATE utf8mb4_bin = %s AND oss_url LIKE 'https://%%' AND vid_index > 0
ORDER BY vid_index, update_time DESC, id DESC
"""

EPISODES_BY_IDS_SQL = """
SELECT series_id, series_title, vid_index, vid, oss_url, update_time
FROM hongguo_video_download_record
WHERE series_id COLLATE utf8mb4_bin IN ({placeholders}) AND oss_url LIKE 'https://%%' AND vid_index > 0
ORDER BY series_id, vid_index, update_time DESC, id DESC
"""

RANKINGS_SQL = """
SELECT
  COALESCE(NULLIF(series_id_str, ''), CAST(series_id AS CHAR)) AS series_id,
  series_title,
  episode_total_cnt,
  JSON_LENGTH(video_list) AS video_list_count,
  hot_score,
  series_play_cnt,
  followed_cnt,
  digg_cnt,
  update_time
FROM hongguo_video_detail_episode_list
WHERE hot_score > 0
ORDER BY hot_score DESC, series_id
LIMIT %s
"""

CHINA_TIME = timezone(timedelta(hours=8))


@dataclass(frozen=True)
class Settings:
    db_host: str
    db_port: int
    db_name: str
    db_user: str
    db_password: str
    origin_token: str
    host: str = "0.0.0.0"
    port: int = 8788

    @classmethod
    def from_env(cls) -> Settings:
        required = {
            name: os.environ.get(name, "").strip()
            for name in ("DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD", "ORIGIN_TOKEN")
        }
        missing = [name for name, value in required.items() if not value]
        if missing:
            raise ValueError(f"missing environment variables: {', '.join(missing)}")
        if len(required["ORIGIN_TOKEN"]) < 32:
            raise ValueError("ORIGIN_TOKEN must contain at least 32 characters")

        return cls(
            db_host=required["DB_HOST"],
            db_port=_integer_env("DB_PORT", 3306, 1, 65535),
            db_name=required["DB_NAME"],
            db_user=required["DB_USER"],
            db_password=required["DB_PASSWORD"],
            origin_token=required["ORIGIN_TOKEN"],
            host=os.environ.get("HOST", "0.0.0.0").strip() or "0.0.0.0",
            port=_integer_env("PORT", 8788, 1, 65535),
        )


class CatalogRepository:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _connect(self):
        # ponytail: one short-lived connection per request; add a pool only after measured catalog traffic warrants it.
        return pymysql.connect(
            host=self.settings.db_host,
            port=self.settings.db_port,
            user=self.settings.db_user,
            password=self.settings.db_password,
            database=self.settings.db_name,
            charset="utf8mb4",
            cursorclass=DictCursor,
            autocommit=True,
            connect_timeout=5,
            read_timeout=15,
            write_timeout=10,
        )

    def list_series(self) -> list[dict[str, object]]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(SERIES_SQL)
            rows = cursor.fetchall()
        return [
            {
                "id": str(row["series_id"]),
                "title": str(row["title"]),
                "episodeCount": int(row["episode_count"]),
            }
            for row in rows
        ]

    def list_rankings(self, limit: int) -> list[dict[str, object]]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(RANKINGS_SQL, (limit,))
            rows = cursor.fetchall()
        return _heat_rankings(rows)

    def get_series(
        self, series_id: str
    ) -> tuple[dict[str, object], list[dict[str, object]]] | None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(DETAIL_BY_ID_SQL, (series_id,))
            details = cursor.fetchall()
            cursor.execute(EPISODES_SQL, (series_id,))
            rows = cursor.fetchall()
        expected_count = _expected_episode_count(details)
        episodes = _dedupe_episode_rows(rows)
        if expected_count is None or not _complete_episode_rows(
            episodes, expected_count
        ):
            return None
        title = _detail_title(details) or next(
            (
                str(row["series_title"]).strip()
                for row in episodes
                if row.get("series_title")
            ),
            series_id,
        )
        manifest = [_episode_manifest(row) for row in episodes]
        return {
            "id": series_id,
            "title": title,
            "episodeCount": expected_count,
        }, manifest

    def resolve_rankings(
        self,
        rankings: list[dict[str, object]],
    ) -> tuple[list[dict[str, object]], dict[str, int]]:
        series_ids = list(dict.fromkeys(str(item["id"]) for item in rankings))
        quality = {
            "ranked": len(rankings),
            "ready": 0,
            "pendingDownload": 0,
            "metadataIncomplete": 0,
            "unmatched": 0,
        }
        if not series_ids:
            return [], quality

        placeholders = ",".join(["%s"] * len(series_ids))
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                DETAILS_BY_IDS_SQL.format(placeholders=placeholders), tuple(series_ids)
            )
            detail_rows = cursor.fetchall()
            cursor.execute(
                EPISODES_BY_IDS_SQL.format(placeholders=placeholders), tuple(series_ids)
            )
            episode_rows = cursor.fetchall()
        return _resolve_rankings(rankings, detail_rows, episode_rows, quality)

    def ready(self) -> bool:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            return cursor.fetchone() is not None


class CatalogHandler(BaseHTTPRequestHandler):
    repository: CatalogRepository
    settings: Settings

    def do_GET(self) -> None:
        url = urlsplit(self.path)
        if url.path == "/health":
            self._json(HTTPStatus.OK, {"status": "ok"})
            return
        if not hmac.compare_digest(
            self.headers.get("X-Storyflow-Origin-Token", ""), self.settings.origin_token
        ):
            self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
            return
        try:
            if url.path == "/ready":
                status = (
                    HTTPStatus.OK
                    if self.repository.ready()
                    else HTTPStatus.SERVICE_UNAVAILABLE
                )
                self._json(
                    status,
                    {"status": "ready" if status == HTTPStatus.OK else "not_ready"},
                )
                return
            if url.path == "/v1/series":
                self._list_series(parse_qs(url.query, keep_blank_values=True))
                return
            if url.path == "/v1/rankings/daily":
                self._list_daily_rankings(parse_qs(url.query, keep_blank_values=True))
                return
            prefix, suffix = "/v1/series/", "/episodes"
            if url.path.startswith(prefix) and url.path.endswith(suffix):
                series_id = url.path[len(prefix) : -len(suffix)]
                if not series_id.isdigit() or len(series_id) > 32:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": "invalid_series_id"})
                    return
                result = self.repository.get_series(series_id)
                if result is None:
                    self._json(
                        HTTPStatus.NOT_FOUND,
                        {"error": "series_not_found_or_incomplete"},
                    )
                    return
                series, episodes = result
                self._json(
                    HTTPStatus.OK,
                    {"version": 1, "series": series, "episodes": episodes},
                )
                return
            self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
        except ValueError as error:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except pymysql.MySQLError:
            self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "catalog_unavailable"})

    def _list_series(self, query: dict[str, list[str]]) -> None:
        q = query.get("q", [""])[0].strip().casefold()
        limit = _query_integer(query, "limit", 50, 1, 100)
        offset = _query_integer(query, "offset", 0, 0, 1_000_000)
        series = self.repository.list_series()
        if q:
            series = [item for item in series if q in str(item["title"]).casefold()]
        self._json(
            HTTPStatus.OK,
            {
                "version": 1,
                "total": len(series),
                "series": series[offset : offset + limit],
            },
        )

    def _list_daily_rankings(self, query: dict[str, list[str]]) -> None:
        if "date" in query:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "ranking_history_unavailable"})
            return
        q = query.get("q", [""])[0].strip().casefold()
        limit = _query_integer(query, "limit", 20, 1, 100)
        rankings = self.repository.list_rankings(100 if q else limit)
        if q:
            rankings = [item for item in rankings if q in str(item["title"]).casefold()]
        if not rankings:
            self._json(HTTPStatus.NOT_FOUND, {"error": "ranking_snapshot_not_found"})
            return
        series, quality = self.repository.resolve_rankings(rankings)
        total = len(series)
        self._json(
            HTTPStatus.OK,
            {
                "version": 1,
                "status": "ok",
                "basis": "hongguo-hot-score",
                "observedAt": rankings[0]["observedAt"],
                "total": total,
                "quality": quality,
                "series": series[:limit],
            },
        )

    def do_POST(self) -> None:
        self._json(
            HTTPStatus.METHOD_NOT_ALLOWED,
            {"error": "method_not_allowed"},
            {"Allow": "GET"},
        )

    def log_message(self, format: str, *args: object) -> None:
        print(f"catalog-api: {self.address_string()} {format % args}", flush=True)

    def _json(
        self,
        status: HTTPStatus,
        body: dict[str, object],
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        encoded = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for name, value in (extra_headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(encoded)


def _integer_env(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name, str(default))
    try:
        value = int(raw)
    except ValueError as error:
        raise ValueError(f"{name} must be an integer") from error
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be from {minimum} to {maximum}")
    return value


def _query_integer(
    query: dict[str, list[str]],
    name: str,
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    raw = query.get(name, [str(default)])[0]
    try:
        value = int(raw)
    except ValueError as error:
        raise ValueError(f"{name}_must_be_integer") from error
    if not minimum <= value <= maximum:
        raise ValueError(f"{name}_out_of_range")
    return value


def _expected_episode_count(rows: list[dict[str, object]]) -> int | None:
    for key in ("video_list_count", "episode_total_cnt"):
        values = [_positive_int(row.get(key)) for row in rows]
        valid = [value for value in values if value is not None]
        if valid:
            return max(valid)
    return None


def _detail_title(rows: list[dict[str, object]]) -> str | None:
    return next(
        (str(row["series_title"]).strip() for row in rows if row.get("series_title")),
        None,
    )


def _dedupe_episode_rows(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    episodes: dict[int, dict[str, object]] = {}
    for row in rows:
        index = _positive_int(row.get("vid_index"))
        url = str(row.get("oss_url") or "")
        if index is not None and url.startswith("https://") and index not in episodes:
            episodes[index] = row
    return [episodes[index] for index in sorted(episodes)]


def _complete_episode_rows(rows: list[dict[str, object]], expected_count: int) -> bool:
    if expected_count < 1 or len(rows) != expected_count:
        return False
    return all(
        _positive_int(row.get("vid_index")) == expected
        for expected, row in enumerate(rows, 1)
    )


def _episode_manifest(row: dict[str, object]) -> dict[str, object]:
    return {
        "episode": int(row["vid_index"]),
        "sourceId": str(row["vid"]),
        "downloadUrl": str(row["oss_url"]),
        "mimeType": "video/mp4",
    }


def _group_rows(
    rows: list[dict[str, object]], key: str
) -> dict[str, list[dict[str, object]]]:
    grouped: dict[str, list[dict[str, object]]] = {}
    for row in rows:
        value = str(row.get(key) or "").strip()
        if value:
            grouped.setdefault(value, []).append(row)
    return grouped


def _resolve_rankings(
    rankings: list[dict[str, object]],
    detail_rows: list[dict[str, object]],
    episode_rows: list[dict[str, object]],
    quality: dict[str, int] | None = None,
) -> tuple[list[dict[str, object]], dict[str, int]]:
    result_quality = quality or {
        "ranked": len(rankings),
        "ready": 0,
        "pendingDownload": 0,
        "metadataIncomplete": 0,
        "unmatched": 0,
    }
    details_by_id = _group_rows(detail_rows, "normalized_series_id")
    episodes_by_id = _group_rows(episode_rows, "series_id")
    ready: list[dict[str, object]] = []
    for ranking in rankings:
        series_id = str(ranking["id"])
        details = details_by_id.get(series_id, [])
        if not details:
            result_quality["unmatched"] += 1
            continue
        expected_count = _expected_episode_count(details)
        if expected_count is None:
            result_quality["metadataIncomplete"] += 1
            continue
        episodes = _dedupe_episode_rows(episodes_by_id.get(series_id, []))
        if not _complete_episode_rows(episodes, expected_count):
            result_quality["pendingDownload"] += 1
            continue
        result_quality["ready"] += 1
        ready.append(
            {
                **ranking,
                "title": _detail_title(details) or str(ranking["title"]),
                "episodeCount": expected_count,
                "ossReady": True,
            }
        )
    return ready, result_quality


def _positive_int(value: object) -> int | None:
    try:
        parsed = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _heat_rankings(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    rankings: list[dict[str, object]] = []
    seen: set[str] = set()
    for row in rows:
        series_id = str(row.get("series_id") or "").strip()
        title = str(row.get("series_title") or "").strip()
        score = _positive_int(row.get("hot_score"))
        observed_at = _normalize_observed_at(row.get("update_time"))
        if not series_id.isdigit() or len(series_id) > 32 or not title:
            continue
        if score is None or observed_at is None or series_id in seen:
            continue
        seen.add(series_id)
        signals = [
            f"{name}={int(row[name])}"
            for name in ("hot_score", "series_play_cnt", "followed_cnt", "digg_cnt")
            if row.get(name) is not None and str(row[name]).strip()
        ]
        rankings.append(
            {
                "id": series_id,
                "title": title,
                "hotRank": len(rankings) + 1,
                "hotScore": score,
                "hotSignals": signals,
                "observedAt": observed_at,
            }
        )
    return rankings


def _normalize_observed_at(value: object) -> str | None:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.strip())
        except ValueError:
            return None
    else:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=CHINA_TIME)
    return parsed.astimezone(CHINA_TIME).isoformat()


def self_test() -> None:
    details = [
        {"episode_total_cnt": 1, "video_list_count": 2, "series_title": "测试剧"}
    ]
    duplicate_rows = [
        {"vid_index": 1, "vid": "a", "oss_url": "https://oss.example/old.mp4"},
        {"vid_index": 1, "vid": "a", "oss_url": "https://oss.example/new.mp4"},
        {"vid_index": 2, "vid": "b", "oss_url": "https://oss.example/2.mp4"},
    ]
    episodes = _dedupe_episode_rows(duplicate_rows)
    assert _expected_episode_count(details) == 2
    assert _complete_episode_rows(episodes, 2)
    assert not _complete_episode_rows(episodes[:1], 2)
    assert _normalize_observed_at("2026-08-01") == "2026-08-01T00:00:00+08:00"
    ranking = _heat_rankings(
        [
            {
                "series_id": "1",
                "series_title": "测试剧",
                "update_time": "2026-08-01 07:00:00",
                "hot_score": 99,
                "series_play_cnt": 88,
            }
        ]
    )[0]
    assert ranking["hotRank"] == 1 and ranking["hotScore"] == 99
    ready, quality = _resolve_rankings(
        [ranking, {**ranking, "id": "2", "hotRank": 2}],
        [{"normalized_series_id": "1", **details[0]}],
        [{"series_id": "1", **row} for row in duplicate_rows],
    )
    assert len(ready) == 1 and ready[0]["ossReady"] is True
    assert quality == {
        "ranked": 2,
        "ready": 1,
        "pendingDownload": 0,
        "metadataIncomplete": 0,
        "unmatched": 1,
    }
    print("self-test: ok")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    settings = Settings.from_env()
    CatalogHandler.settings = settings
    CatalogHandler.repository = CatalogRepository(settings)
    server = ThreadingHTTPServer((settings.host, settings.port), CatalogHandler)
    print(f"catalog-api: listening on {settings.host}:{settings.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
