# input: A bounded ReelShort title query and the configured short2api endpoint
# output: Normalized series candidates keyed by ReelShort source ID
# pos: Read-only anti-corruption adapter for live ReelShort catalog search

from __future__ import annotations

import json
from collections.abc import Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import urlopen


class ReelShortSearchError(Exception):
    pass


class ReelShortSearchClient:
    def __init__(
        self,
        base_url: str,
        timeout: float = 8,
        open_url: Callable[..., object] = urlopen,
    ) -> None:
        parsed = urlsplit(base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("REELSHORT_SEARCH_URL must use HTTP or HTTPS")
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.open_url = open_url

    def search(self, query: str, limit: int) -> dict[str, object]:
        url = f"{self.base_url}/api/v1/search?{urlencode({'q': query, 'platform': 'reelshort'})}"
        try:
            with self.open_url(url, timeout=self.timeout) as response:  # type: ignore[attr-defined]
                payload = json.load(response)
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
            raise ReelShortSearchError("upstream_unavailable") from error

        if (
            not isinstance(payload, dict)
            or payload.get("platform") != "reelshort"
            or not isinstance(payload.get("items"), list)
        ):
            raise ReelShortSearchError("invalid_response")

        matches = [
            match
            for item in payload["items"]
            if isinstance(item, dict)
            and (match := _series_match(item)) is not None
        ][:limit]
        return {
            "status": "ok",
            "provider": "short2api",
            "query": query,
            "returned": len(matches),
            "matches": matches,
        }


def _series_match(item: dict[str, object]) -> dict[str, object] | None:
    source_id = str(item.get("id") or "").strip()
    title = str(item.get("title") or "").strip()
    if not source_id or not title:
        return None
    chapter_count = item.get("chapter_count")
    return {
        "source": "reelshort",
        "sourceSeriesId": source_id,
        "title": title,
        "description": str(item.get("description") or "").strip(),
        "tags": [str(tag) for tag in item.get("tags", [])]
        if isinstance(item.get("tags"), list)
        else [],
        "language": str(item.get("language") or "").strip(),
        "coverUrl": str(item.get("cover_url") or "").strip(),
        "declaredEpisodeCount": chapter_count
        if isinstance(chapter_count, int) and chapter_count > 0
        else None,
    }
