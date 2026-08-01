# input: Source-scoped ranking, series, and episode facts from catalog adapters
# output: Stable v2 ranking entries, media coverage, and snapshot identities
# pos: Pure short-drama discovery domain model shared by every catalog source

from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta, timezone

CHINA_TIME = timezone(timedelta(hours=8))


def positive_int(value: object) -> int | None:
    try:
        parsed = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def nonnegative_int(value: object) -> int:
    try:
        parsed = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0
    return max(parsed, 0)


def observed_at(value: object) -> str | None:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, date):
        parsed = datetime.combine(value, time.min)
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


def parse_week(value: str) -> tuple[str, str] | None:
    match = re.fullmatch(r"(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})", value)
    if not match:
        return None
    try:
        start, end = date.fromisoformat(match[1]), date.fromisoformat(match[2])
    except ValueError:
        return None
    if start > end:
        return None
    return start.isoformat(), end.isoformat()


def ranking_snapshot(
    source: str,
    ranking_kind: str,
    period_start: str,
    period_end: str,
    observed: object,
) -> dict[str, object]:
    suffix = (
        period_start if period_start == period_end else f"{period_start}_{period_end}"
    )
    return {
        "key": f"{source}:{ranking_kind}:{suffix}",
        "evidenceSource": source,
        "rankingKind": ranking_kind,
        "periodStart": period_start,
        "periodEnd": period_end,
        "observedAt": observed_at(observed),
    }


def series_record(
    source: str,
    source_id: object,
    title: object,
    total_episode_count: object,
) -> dict[str, object] | None:
    normalized_id = str(source_id or "").strip()
    normalized_title = str(title or "").strip()
    if not normalized_id or not normalized_title:
        return None
    return {
        "key": f"{source}:{normalized_id}",
        "source": source,
        "sourceSeriesId": normalized_id,
        "title": normalized_title,
        "totalEpisodeCount": positive_int(total_episode_count),
    }


def media_coverage(
    declared: object,
    metadata: object,
    playable: object,
    oss: object,
    contiguous: bool,
    delivery: str,
) -> dict[str, object]:
    declared_count = positive_int(declared)
    metadata_count = nonnegative_int(metadata)
    playable_count = nonnegative_int(playable)
    oss_count = nonnegative_int(oss)
    reasons: list[str] = []
    if declared_count is None:
        reasons.append("unknown_declared_episode_count")
    else:
        if metadata_count != declared_count:
            reasons.append("incomplete_episode_metadata")
        if metadata_count == declared_count and not contiguous:
            reasons.append("non_contiguous_episode_metadata")
        if playable_count != declared_count:
            reasons.append("incomplete_playable_media")
    if playable_count > 0 and delivery not in {"oss_file", "https_file"}:
        reasons.append("unsupported_media_delivery")
    conversion_ready = declared_count is not None and not reasons
    metadata_complete = (
        declared_count is not None and metadata_count == declared_count and contiguous
    )
    status = (
        "ready"
        if conversion_ready
        else "partial"
        if metadata_count > 0 or playable_count > 0
        else "unavailable"
    )
    return {
        "declaredEpisodeCount": declared_count,
        "metadataEpisodeCount": metadata_count,
        "playableEpisodeCount": playable_count,
        "ossEpisodeCount": oss_count,
        "metadataComplete": metadata_complete,
        "status": status,
        "delivery": delivery,
        "conversionReady": conversion_ready,
        "reasons": reasons,
    }


def ranking_entry(
    series: dict[str, object],
    rank: object,
    metrics: dict[str, object],
    media: dict[str, object],
    observed: object,
) -> dict[str, object] | None:
    normalized_rank = positive_int(rank)
    normalized_observed = observed_at(observed)
    if normalized_rank is None or normalized_observed is None:
        return None
    return {
        "series": series,
        "ranking": {
            "rank": normalized_rank,
            "metrics": {
                name: int(value) for name, value in metrics.items() if value is not None
            },
            "observedAt": normalized_observed,
        },
        "media": media,
    }


def self_test() -> None:
    assert parse_week("2026-07-20 ~ 2026-07-26") == (
        "2026-07-20",
        "2026-07-26",
    )
    ready = media_coverage(2, 2, 2, 2, True, "oss_file")
    assert ready["conversionReady"] is True and ready["reasons"] == []
    partial = media_coverage(87, 8, 8, 0, True, "signed_hls")
    assert partial["conversionReady"] is False
    assert partial["reasons"] == [
        "incomplete_episode_metadata",
        "incomplete_playable_media",
        "unsupported_media_delivery",
    ]
