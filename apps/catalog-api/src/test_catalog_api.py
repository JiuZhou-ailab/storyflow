# input: Fake Catalog repository rows and authenticated local HTTP requests
# output: Regression coverage for v1 complete-series compatibility and ranking identity
# pos: Small stdlib release gate for the Catalog API compatibility surface

from __future__ import annotations

import json
import threading
import unittest
from datetime import datetime
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen

import catalog_sources
from catalog_api import CatalogHandler, Settings


class _Repository:
    def legacy_series(self) -> list[dict[str, object]]:
        return [
            {"id": "cold-complete", "title": "Cold Complete", "episodeCount": 2},
            {"id": "hot-complete", "title": "Hot Complete", "episodeCount": 3},
        ]


class _Handler(CatalogHandler):
    def log_message(self, format: str, *args: object) -> None:
        pass


class CatalogApiCompatibilityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        _Handler.settings = Settings(
            db_host="unused",
            db_port=3306,
            db_name="unused",
            db_user="unused",
            db_password="unused",
            origin_token="test-origin-token-that-is-at-least-32-chars",
        )
        _Handler.repository = _Repository()  # type: ignore[assignment]
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def test_v1_series_lists_complete_series_independently_of_hot_rankings(self) -> None:
        request = Request(
            f"http://127.0.0.1:{self.server.server_port}/v1/series?q=cold",
            headers={"X-Storyflow-Origin-Token": _Handler.settings.origin_token},
        )
        with urlopen(request, timeout=2) as response:
            body = json.load(response)

        self.assertEqual(response.status, 200)
        self.assertEqual(body["total"], 1)
        self.assertEqual(body["series"][0]["id"], "cold-complete")

    def test_hongguo_rankings_dedupe_series_ids_without_rank_gaps(self) -> None:
        rows = [
            _hongguo_row("series-1", 100),
            _hongguo_row("series-1", 90),
            _hongguo_row("series-2", 80),
        ]

        entries = catalog_sources._hongguo_entries(rows)

        self.assertEqual(
            [entry["series"]["sourceSeriesId"] for entry in entries],
            ["series-1", "series-2"],
        )
        self.assertEqual([entry["ranking"]["rank"] for entry in entries], [1, 2])

    def test_dataeye_snapshots_use_allowlisted_static_queries(self) -> None:
        for ranking_kind, week in (
            ("weekly_hot", "2026-07-27 ~ 2026-08-02"),
            ("weekly_rank", "2026-07-20 ~ 2026-07-26"),
        ):
            period_start, period_end = week.split(" ~ ")
            cursor = _Cursor(
                [{"week": week, "observed_at": datetime(2026, 8, 2, 12, 0)}]
            )

            snapshots = catalog_sources.list_snapshots(
                cursor, "dataeye", ranking_kind
            )

            self.assertEqual(
                cursor.queries,
                [catalog_sources.DATAEYE_SNAPSHOT_SQL[ranking_kind]],
            )
            self.assertEqual(len(snapshots), 1)
            self.assertEqual(
                snapshots[0],
                {
                    "key": f"dataeye:{ranking_kind}:{period_start}_{period_end}",
                    "evidenceSource": "dataeye",
                    "rankingKind": ranking_kind,
                    "periodStart": period_start,
                    "periodEnd": period_end,
                    "observedAt": "2026-08-02T12:00:00+08:00",
                },
            )

        invalid_cursor = _Cursor([])
        with self.assertRaisesRegex(ValueError, "unsupported_ranking_kind"):
            catalog_sources.list_snapshots(
                invalid_cursor, "dataeye", "weekly_hot;DROP TABLE"
            )
        self.assertEqual(invalid_cursor.queries, [])


def _hongguo_row(series_id: str, hot_score: int) -> dict[str, object]:
    return {
        "series_id": series_id,
        "series_title": series_id,
        "episode_count": 2,
        "playable_episode_count": 2,
        "first_episode": 1,
        "last_episode": 2,
        "hot_score": hot_score,
        "update_time": "2026-08-02T00:00:00Z",
    }


class _Cursor:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self.rows = rows
        self.queries: list[str] = []

    def execute(self, query: str, params: object = None) -> None:
        del params
        self.queries.append(query)

    def fetchall(self) -> list[dict[str, object]]:
        return self.rows


if __name__ == "__main__":
    unittest.main()
