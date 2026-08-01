# input: Fake Catalog repository rows and authenticated local HTTP requests
# output: Regression coverage for v1 complete-series compatibility and ranking identity
# pos: Small stdlib release gate for the Catalog API compatibility surface

from __future__ import annotations

import json
import threading
import unittest
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


if __name__ == "__main__":
    unittest.main()
