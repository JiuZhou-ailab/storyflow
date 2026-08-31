# input: Stubbed short2api responses and Catalog repository queries
# output: Regression coverage for normalized ReelShort title search
# pos: Focused contract test for the live series-search augmentation

from __future__ import annotations

import io
import json
import unittest
from typing import ClassVar
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import catalog_sources
from catalog_api import CatalogRepository, Settings
from reelshort_search import ReelShortSearchClient, ReelShortSearchError


class ReelShortSearchTest(unittest.TestCase):
    def test_normalizes_and_bounds_title_matches(self) -> None:
        calls: list[tuple[str, float]] = []

        def open_url(url: str, timeout: float):
            calls.append((url, timeout))
            return io.BytesIO(
                json.dumps(
                    {
                        "platform": "reelshort",
                        "query": "Drama",
                        "items": [
                            {
                                "id": "series-1",
                                "title": "Drama One",
                                "description": "First match",
                                "tags": ["Romance"],
                                "language": "es",
                                "cover_url": "https://example.com/cover.jpg",
                                "chapter_count": 60,
                            },
                            {"id": "series-2", "title": "Drama Two"},
                        ],
                    }
                ).encode()
            )

        result = ReelShortSearchClient(
            "http://47.91.2.252:8001", open_url=open_url
        ).search("Drama", limit=1)

        query = parse_qs(urlsplit(calls[0][0]).query)
        self.assertEqual(query, {"q": ["Drama"], "platform": ["reelshort"]})
        self.assertEqual(calls[0][1], 8)
        self.assertEqual(
            result,
            {
                "status": "ok",
                "provider": "short2api",
                "query": "Drama",
                "returned": 1,
                "matches": [
                    {
                        "source": "reelshort",
                        "sourceSeriesId": "series-1",
                        "title": "Drama One",
                        "description": "First match",
                        "tags": ["Romance"],
                        "language": "es",
                        "coverUrl": "https://example.com/cover.jpg",
                        "declaredEpisodeCount": 60,
                    }
                ],
            },
        )

    def test_rejects_an_invalid_upstream_envelope(self) -> None:
        client = ReelShortSearchClient(
            "http://47.91.2.252:8001",
            open_url=lambda _url, timeout: io.BytesIO(b'{"items": {}}'),
        )

        with self.assertRaisesRegex(ReelShortSearchError, "invalid_response"):
            client.search("Drama", limit=20)

    def test_repository_adds_live_matches_without_changing_assets(self) -> None:
        settings = Settings(
            db_host="unused",
            db_port=3306,
            db_name="unused",
            db_user="unused",
            db_password="unused",
            origin_token="test-origin-token-that-is-at-least-32-chars",
            reelshort_search_url="http://47.91.2.252:8001",
        )
        search_client = _SearchClient()
        repository = CatalogRepository(settings, search_client)

        with patch.object(
            repository, "_connect", return_value=_Connection()
        ), patch.object(
            catalog_sources,
            "query_video_assets",
            return_value={
                "source": "reelshort",
                "total": 1,
                "offset": 0,
                "limit": 20,
                "nextOffset": None,
                "assets": [{"sourceAssetId": "episode-1"}],
            },
        ):
            result = repository.video_assets("reelshort", "Drama", "", 20, 0)

        self.assertEqual(result["assets"], [{"sourceAssetId": "episode-1"}])
        self.assertEqual(result["seriesSearch"], _SearchClient.RESULT)
        self.assertEqual(search_client.calls, [("Drama", 20)])


class _SearchClient:
    RESULT: ClassVar[dict[str, object]] = {
        "status": "ok",
        "provider": "short2api",
        "query": "Drama",
        "returned": 1,
        "matches": [{"sourceSeriesId": "series-1", "title": "Drama One"}],
    }

    def __init__(self) -> None:
        self.calls: list[tuple[str, int]] = []

    def search(self, query: str, limit: int) -> dict[str, object]:
        self.calls.append((query, limit))
        return self.RESULT


class _Connection:
    def __enter__(self):
        return self

    def __exit__(self, *_args: object) -> None:
        pass

    def cursor(self):
        return self


if __name__ == "__main__":
    unittest.main()
