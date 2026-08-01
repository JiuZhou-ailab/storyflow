# input: MySQL read-only credentials and origin-authenticated HTTP GET requests
# output: Complete-series catalog and ordered OSS episode manifests
# pos: Private-network adapter between jz_crawler and the Storyflow edge gateway

from __future__ import annotations

import argparse
import hmac
import json
import os
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

import pymysql
from pymysql.cursors import DictCursor


SERIES_SQL = """
SELECT
  series_id,
  COALESCE(NULLIF(MAX(series_title), ''), series_id) AS title,
  COUNT(*) AS episode_count,
  MIN(vid_index) AS first_episode,
  MAX(vid_index) AS last_episode,
  COUNT(DISTINCT vid_index) AS distinct_episode_count
FROM hongguo_video_download_record
WHERE oss_url IS NOT NULL AND oss_url <> ''
GROUP BY series_id
HAVING first_episode = 1
  AND last_episode = episode_count
  AND distinct_episode_count = episode_count
ORDER BY title, series_id
"""

EPISODES_SQL = """
SELECT series_id, series_title, vid_index, vid, oss_url
FROM hongguo_video_download_record
WHERE series_id = %s AND oss_url IS NOT NULL AND oss_url <> ''
ORDER BY vid_index
"""


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
    def from_env(cls) -> "Settings":
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
            read_timeout=10,
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

    def get_series(self, series_id: str) -> tuple[dict[str, object], list[dict[str, object]]] | None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(EPISODES_SQL, (series_id,))
            rows = cursor.fetchall()
        if not _complete_episode_rows(rows):
            return None
        title = next((str(row["series_title"]).strip() for row in rows if row["series_title"]), series_id)
        episodes = [
            {
                "episode": int(row["vid_index"]),
                "sourceId": str(row["vid"]),
                "downloadUrl": str(row["oss_url"]),
                "mimeType": "video/mp4",
            }
            for row in rows
        ]
        return {"id": series_id, "title": title, "episodeCount": len(episodes)}, episodes

    def ready(self) -> bool:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            return cursor.fetchone() is not None


class CatalogHandler(BaseHTTPRequestHandler):
    repository: CatalogRepository
    settings: Settings

    def do_GET(self) -> None:  # noqa: N802
        url = urlsplit(self.path)
        if url.path == "/health":
            self._json(HTTPStatus.OK, {"status": "ok"})
            return
        if not hmac.compare_digest(self.headers.get("X-Storyflow-Origin-Token", ""), self.settings.origin_token):
            self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
            return
        try:
            if url.path == "/ready":
                status = HTTPStatus.OK if self.repository.ready() else HTTPStatus.SERVICE_UNAVAILABLE
                self._json(status, {"status": "ready" if status == HTTPStatus.OK else "not_ready"})
                return
            if url.path == "/v1/series":
                query = parse_qs(url.query, keep_blank_values=True)
                q = query.get("q", [""])[0].strip().casefold()
                limit = _query_integer(query, "limit", 50, 1, 100)
                offset = _query_integer(query, "offset", 0, 0, 1_000_000)
                series = self.repository.list_series()
                if q:
                    series = [item for item in series if q in str(item["title"]).casefold()]
                self._json(HTTPStatus.OK, {
                    "version": 1,
                    "total": len(series),
                    "series": series[offset:offset + limit],
                })
                return
            prefix, suffix = "/v1/series/", "/episodes"
            if url.path.startswith(prefix) and url.path.endswith(suffix):
                series_id = url.path[len(prefix):-len(suffix)]
                if not series_id.isdigit() or len(series_id) > 32:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": "invalid_series_id"})
                    return
                result = self.repository.get_series(series_id)
                if result is None:
                    self._json(HTTPStatus.NOT_FOUND, {"error": "series_not_found_or_incomplete"})
                    return
                series, episodes = result
                self._json(HTTPStatus.OK, {"version": 1, "series": series, "episodes": episodes})
                return
            self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
        except ValueError as error:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except pymysql.MySQLError:
            self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "catalog_unavailable"})

    def do_POST(self) -> None:  # noqa: N802
        self._json(HTTPStatus.METHOD_NOT_ALLOWED, {"error": "method_not_allowed"}, {"Allow": "GET"})

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


def _query_integer(query: dict[str, list[str]], name: str, default: int, minimum: int, maximum: int) -> int:
    raw = query.get(name, [str(default)])[0]
    try:
        value = int(raw)
    except ValueError as error:
        raise ValueError(f"{name}_must_be_integer") from error
    if not minimum <= value <= maximum:
        raise ValueError(f"{name}_out_of_range")
    return value


def _complete_episode_rows(rows: list[dict[str, object]]) -> bool:
    if not rows:
        return False
    for expected, row in enumerate(rows, 1):
        if row.get("vid_index") != expected:
            return False
        url = str(row.get("oss_url") or "")
        if not url.startswith("https://"):
            return False
    return True


def self_test() -> None:
    assert _complete_episode_rows([
        {"vid_index": 1, "oss_url": "https://oss.example/1.mp4"},
        {"vid_index": 2, "oss_url": "https://oss.example/2.mp4"},
    ])
    assert not _complete_episode_rows([
        {"vid_index": 1, "oss_url": "https://oss.example/1.mp4"},
        {"vid_index": 3, "oss_url": "https://oss.example/3.mp4"},
    ])
    assert _query_integer({"limit": ["10"]}, "limit", 50, 1, 100) == 10
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
