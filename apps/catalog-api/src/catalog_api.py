# input: MySQL read-only credentials and origin-authenticated Catalog HTTP requests
# output: Stable multi-source rankings and complete-series manifests, plus v1 compatibility
# pos: Private read-model API behind the Storyflow edge gateway

from __future__ import annotations

import argparse
import hmac
import json
import os
import re
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

import catalog_domain
import catalog_sources
import pymysql
from pymysql.cursors import DictCursor

MANIFEST_PATH = re.compile(
    r"/v2/series/(?P<source>[a-z0-9-]{1,32})/"
    r"(?P<source_id>[A-Za-z0-9_-]{1,64})/manifest"
)


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
        # ponytail: one short-lived connection per operation; pool after measured demand.
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

    def sources(self) -> list[dict[str, object]]:
        return catalog_sources.list_sources()

    def snapshots(self, source: str, ranking_kind: str) -> list[dict[str, object]]:
        with self._connect() as connection, connection.cursor() as cursor:
            return catalog_sources.list_snapshots(cursor, source, ranking_kind)

    def ranking_group(
        self, source: str, ranking_kind: str, snapshot_key: str
    ) -> dict[str, object] | None:
        with self._connect() as connection, connection.cursor() as cursor:
            snapshots = catalog_sources.list_snapshots(cursor, source, ranking_kind)
            snapshot = _select_snapshot(snapshots, snapshot_key)
            if snapshot is None:
                return None
            entries = catalog_sources.list_rankings(
                cursor, source, ranking_kind, snapshot
            )
        return {
            "source": source,
            "snapshot": snapshot,
            "total": len(entries),
            "entries": entries,
        }

    def manifest(self, source: str, source_id: str) -> dict[str, object] | None:
        with self._connect() as connection, connection.cursor() as cursor:
            return catalog_sources.get_manifest(cursor, source, source_id)

    def legacy_series(self) -> list[dict[str, object]]:
        with self._connect() as connection, connection.cursor() as cursor:
            return catalog_sources.list_complete_hongguo_series(cursor)

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
        query = parse_qs(url.query, keep_blank_values=True)
        try:
            if url.path == "/ready":
                _validate_query(query, set())
                ready = self.repository.ready()
                self._json(
                    HTTPStatus.OK if ready else HTTPStatus.SERVICE_UNAVAILABLE,
                    {"status": "ready" if ready else "not_ready"},
                )
            elif url.path == "/v2/catalog/sources":
                _validate_query(query, set())
                self._json(
                    HTTPStatus.OK,
                    {"version": 2, "sources": self.repository.sources()},
                )
            elif url.path == "/v2/ranking-snapshots":
                self._ranking_snapshots(query)
            elif url.path == "/v2/rankings":
                self._rankings(query)
            elif match := MANIFEST_PATH.fullmatch(url.path):
                _validate_query(query, set())
                self._manifest(match["source"], match["source_id"])
            elif url.path == "/v1/series":
                self._legacy_series(query)
            elif url.path == "/v1/rankings/daily":
                self._legacy_rankings(query)
            elif match := re.fullmatch(r"/v1/series/(\d{1,32})/episodes", url.path):
                _validate_query(query, set())
                self._legacy_manifest(match[1])
            else:
                self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
        except ValueError as error:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except pymysql.MySQLError:
            self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "catalog_unavailable"})

    def _ranking_snapshots(self, query: dict[str, list[str]]) -> None:
        _validate_query(query, {"source", "rankingKind"})
        source = _query_value(query, "source", "all")
        ranking_kind = _query_value(query, "rankingKind")
        sources = _requested_sources(source)
        if source == "all" and ranking_kind:
            raise ValueError("ranking_kind_requires_single_source")
        groups = []
        for item in sources:
            kind = ranking_kind or catalog_sources.default_ranking_kind(item)
            snapshots = self.repository.snapshots(item, kind)
            groups.append(
                {
                    "source": item,
                    "rankingKind": kind,
                    "snapshots": snapshots,
                }
            )
        self._json(HTTPStatus.OK, {"version": 2, "groups": groups})

    def _rankings(self, query: dict[str, list[str]]) -> None:
        _validate_query(
            query,
            {"source", "rankingKind", "snapshot", "q", "limit", "conversionReady"},
        )
        source = _query_value(query, "source", "all")
        ranking_kind = _query_value(query, "rankingKind")
        snapshot_key = _query_value(query, "snapshot", "latest")
        search = _query_value(query, "q").casefold()
        limit = _query_integer(query, "limit", 20, 1, 100)
        readiness = _query_value(query, "conversionReady", "any")
        if readiness not in {"any", "true", "false"}:
            raise ValueError("invalid_conversion_ready")
        if source == "all" and ranking_kind:
            raise ValueError("ranking_kind_requires_single_source")
        if source == "all" and snapshot_key != "latest":
            raise ValueError("snapshot_requires_single_source")

        groups: list[dict[str, object]] = []
        for item in _requested_sources(source):
            kind = ranking_kind or catalog_sources.default_ranking_kind(item)
            group = self.repository.ranking_group(item, kind, snapshot_key)
            if group is None:
                continue
            entries = [
                entry
                for entry in group["entries"]  # type: ignore[union-attr]
                if _matches_entry(entry, search, readiness)
            ]
            groups.append({**group, "total": len(entries), "entries": entries[:limit]})
        if not groups:
            self._json(
                HTTPStatus.NOT_FOUND,
                {"version": 2, "error": "ranking_snapshot_not_found"},
            )
            return
        self._json(
            HTTPStatus.OK,
            {
                "version": 2,
                "status": "ok",
                "total": sum(int(group["total"]) for group in groups),
                "groups": groups,
            },
        )

    def _manifest(self, source: str, source_id: str) -> None:
        manifest = self.repository.manifest(source, source_id)
        if manifest is None:
            self._json(
                HTTPStatus.NOT_FOUND,
                {"version": 2, "error": "series_not_found"},
            )
            return
        if manifest["media"]["conversionReady"] is not True:  # type: ignore[index]
            self._json(
                HTTPStatus.CONFLICT,
                {
                    "version": 2,
                    "error": "manifest_not_ready",
                    "series": manifest["series"],
                    "media": manifest["media"],
                },
            )
            return
        self._json(HTTPStatus.OK, {"version": 2, **manifest})

    def _legacy_series(self, query: dict[str, list[str]]) -> None:
        _validate_query(query, {"q", "limit", "offset"})
        search = _query_value(query, "q").casefold()
        limit = _query_integer(query, "limit", 50, 1, 100)
        offset = _query_integer(query, "offset", 0, 0, 1_000_000)
        entries = self.repository.legacy_series()
        series = [
            entry for entry in entries if search in str(entry["title"]).casefold()
        ]
        self._json(
            HTTPStatus.OK,
            {
                "version": 1,
                "total": len(series),
                "series": series[offset : offset + limit],
            },
        )

    def _legacy_rankings(self, query: dict[str, list[str]]) -> None:
        _validate_query(query, {"q", "limit", "date"})
        if "date" in query:
            raise ValueError("ranking_history_unavailable")
        search = _query_value(query, "q").casefold()
        limit = _query_integer(query, "limit", 20, 1, 100)
        group = self.repository.ranking_group("hongguo", "current_hot", "latest")
        if group is None:
            self._json(HTTPStatus.NOT_FOUND, {"error": "ranking_snapshot_not_found"})
            return
        ranked = [
            entry
            for entry in group["entries"]  # type: ignore[union-attr]
            if search in str(entry["series"]["title"]).casefold()  # type: ignore[index]
        ]
        ready = [entry for entry in ranked if entry["media"]["conversionReady"] is True]  # type: ignore[index]
        observed = ranked[0]["ranking"]["observedAt"] if ranked else None  # type: ignore[index]
        quality = {
            "ranked": len(ranked),
            "ready": len(ready),
            "pendingDownload": len(ranked) - len(ready),
            "metadataIncomplete": 0,
            "unmatched": 0,
        }
        self._json(
            HTTPStatus.OK,
            {
                "version": 1,
                "status": "ok",
                "basis": "hongguo-hot-score",
                "observedAt": observed,
                "total": len(ready),
                "quality": quality,
                "series": [_legacy_ranking(entry) for entry in ready[:limit]],
            },
        )

    def _legacy_manifest(self, series_id: str) -> None:
        manifest = self.repository.manifest("hongguo", series_id)
        if manifest is None or manifest["media"]["conversionReady"] is not True:  # type: ignore[index]
            self._json(
                HTTPStatus.NOT_FOUND,
                {"error": "series_not_found_or_incomplete"},
            )
            return
        self._json(
            HTTPStatus.OK,
            {
                "version": 1,
                "series": _legacy_series_from_manifest(manifest["series"]),
                "episodes": manifest["episodes"],
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


def _requested_sources(source: str) -> list[str]:
    if source == "all":
        return list(catalog_sources.SOURCE_DEFINITIONS)
    catalog_sources.default_ranking_kind(source)
    return [source]


def _select_snapshot(
    snapshots: list[dict[str, object]], key: str
) -> dict[str, object] | None:
    if key == "latest":
        return snapshots[0] if snapshots else None
    return next((snapshot for snapshot in snapshots if snapshot["key"] == key), None)


def _matches_entry(entry: dict[str, object], search: str, readiness: str) -> bool:
    title = str(entry["series"]["title"]).casefold()  # type: ignore[index]
    ready = entry["media"]["conversionReady"] is True  # type: ignore[index]
    return (not search or search in title) and (
        readiness == "any" or ready is (readiness == "true")
    )


def _legacy_series_record(entry: dict[str, object]) -> dict[str, object]:
    return _legacy_series_from_manifest(entry["series"])  # type: ignore[arg-type]


def _legacy_series_from_manifest(series: dict[str, object]) -> dict[str, object]:
    return {
        "id": series["sourceSeriesId"],
        "title": series["title"],
        "episodeCount": series["totalEpisodeCount"],
    }


def _legacy_ranking(entry: dict[str, object]) -> dict[str, object]:
    metrics = entry["ranking"]["metrics"]  # type: ignore[index]
    return {
        **_legacy_series_record(entry),
        "hotRank": entry["ranking"]["rank"],  # type: ignore[index]
        "hotScore": metrics.get("hotScore"),  # type: ignore[union-attr]
        "hotSignals": [f"{name}={value}" for name, value in metrics.items()],  # type: ignore[union-attr]
        "observedAt": entry["ranking"]["observedAt"],  # type: ignore[index]
        "ossReady": True,
    }


def _validate_query(query: dict[str, list[str]], allowed: set[str]) -> None:
    unknown = set(query) - allowed
    if unknown:
        raise ValueError(f"unknown_query_parameter:{min(unknown)}")
    duplicate = next((name for name, values in query.items() if len(values) != 1), None)
    if duplicate:
        raise ValueError(f"duplicate_query_parameter:{duplicate}")


def _query_value(query: dict[str, list[str]], name: str, default: str = "") -> str:
    return query.get(name, [default])[0].strip()


def _query_integer(
    query: dict[str, list[str]],
    name: str,
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    raw = _query_value(query, name, str(default))
    try:
        value = int(raw)
    except ValueError as error:
        raise ValueError(f"{name}_must_be_integer") from error
    if not minimum <= value <= maximum:
        raise ValueError(f"{name}_out_of_range")
    return value


def _integer_env(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError as error:
        raise ValueError(f"{name} must be an integer") from error
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be from {minimum} to {maximum}")
    return value


def self_test() -> None:
    catalog_domain.self_test()
    catalog_sources.self_test()
    snapshots = [{"key": "a"}, {"key": "b"}]
    assert _select_snapshot(snapshots, "latest") == snapshots[0]
    assert _select_snapshot(snapshots, "b") == snapshots[1]
    try:
        _validate_query({"table": ["secret"]}, {"source"})
    except ValueError as error:
        assert str(error) == "unknown_query_parameter:table"
    else:
        raise AssertionError("unknown query parameters must fail")
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
