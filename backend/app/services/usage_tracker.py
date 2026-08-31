"""Record and aggregate Anthropic Claude API usage for cost tracking."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal, engine
from app.models.usage import LlmUsageEvent

logger = logging.getLogger(__name__)

RangeKey = Literal["1h", "6h", "24h", "7d", "30d", "90d"]
GroupKey = Literal["none", "model", "provider"]

RANGE_SECONDS: dict[str, int] = {
    "1h": 3600,
    "6h": 6 * 3600,
    "24h": 24 * 3600,
    "7d": 7 * 86400,
    "30d": 30 * 86400,
    "90d": 90 * 86400,
}

BUCKET_COUNTS: dict[str, int] = {
    "1h": 12,
    "6h": 24,
    "24h": 24,
    "7d": 28,
    "30d": 30,
    "90d": 30,
}


def _token_fields(usage: Any) -> tuple[int, int, int, int]:
    if usage is None:
        return 0, 0, 0, 0
    return (
        int(getattr(usage, "input_tokens", 0) or 0),
        int(getattr(usage, "output_tokens", 0) or 0),
        int(getattr(usage, "cache_read_input_tokens", 0) or 0),
        int(getattr(usage, "cache_creation_input_tokens", 0) or 0),
    )


def estimate_cost_usd(
    *,
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int = 0,
    cache_creation_tokens: int = 0,
) -> float:
    _ = model
    input_rate = settings.anthropic_input_price_per_mtok
    output_rate = settings.anthropic_output_price_per_mtok
    cache_read_rate = settings.anthropic_cache_read_price_per_mtok
    cache_write_rate = settings.anthropic_cache_write_price_per_mtok

    billable_input = max(input_tokens - cache_read_tokens - cache_creation_tokens, 0)
    cost = (
        billable_input * input_rate
        + output_tokens * output_rate
        + cache_read_tokens * cache_read_rate
        + cache_creation_tokens * cache_write_rate
    ) / 1_000_000
    return round(cost, 6)


async def record_llm_usage(
    *,
    model: str,
    endpoint: str,
    usage: Any = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    cache_read_tokens: int | None = None,
    cache_creation_tokens: int | None = None,
    latency_ms: float | None = None,
    success: bool = True,
) -> None:
    if usage is not None:
        inp, out, cr, cc = _token_fields(usage)
    else:
        inp = int(input_tokens or 0)
        out = int(output_tokens or 0)
        cr = int(cache_read_tokens or 0)
        cc = int(cache_creation_tokens or 0)

    if success and inp == 0 and out == 0:
        return

    cost = 0.0
    if success and (inp or out):
        cost = estimate_cost_usd(
            model=model,
            input_tokens=inp,
            output_tokens=out,
            cache_read_tokens=cr,
            cache_creation_tokens=cc,
        )

    try:
        async with AsyncSessionLocal() as session:
            session.add(
                LlmUsageEvent(
                    provider="anthropic",
                    model=model,
                    endpoint=endpoint,
                    input_tokens=inp,
                    output_tokens=out,
                    cache_read_tokens=cr,
                    cache_creation_tokens=cc,
                    cost_usd=cost,
                    latency_ms=latency_ms,
                    success=success,
                )
            )
            await session.commit()
    except Exception:
        logger.warning("Failed to record LLM usage for %s", endpoint, exc_info=True)


def _pct_change(current: float, previous: float) -> float | None:
    if previous == 0:
        return 100.0 if current > 0 else 0.0
    return round(((current - previous) / previous) * 100, 1)


def _stats(events: list[LlmUsageEvent]) -> dict[str, float | int]:
    total = len(events)
    failures = sum(1 for e in events if not e.success)
    input_tokens = sum(e.input_tokens for e in events)
    cache_read = sum(e.cache_read_tokens for e in events)
    latencies = [e.latency_ms for e in events if e.latency_ms is not None and e.success]

    return {
        "requests": total,
        "failures": failures,
        "input_tokens": input_tokens,
        "output_tokens": sum(e.output_tokens for e in events),
        "cost_usd": round(sum(float(e.cost_usd) for e in events), 4),
        "avg_latency_ms": round(sum(latencies) / len(latencies), 1) if latencies else 0.0,
        "error_rate_pct": round((failures / total) * 100, 2) if total else 0.0,
        "cache_hit_rate_pct": round((cache_read / input_tokens) * 100, 2) if input_tokens else 0.0,
    }


def _bucketize(events: list[LlmUsageEvent], start: datetime, end: datetime, buckets: int) -> list[dict]:
    span = (end - start).total_seconds()
    slot = span / buckets if buckets else span
    slots = [
        {
            "ts": (start + timedelta(seconds=i * slot)).isoformat(),
            "requests": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "cost_usd": 0.0,
            "latency_ms_sum": 0.0,
            "latency_count": 0,
            "errors": 0,
        }
        for i in range(buckets)
    ]

    for ev in events:
        ts = ev.created_at.replace(tzinfo=timezone.utc) if ev.created_at.tzinfo is None else ev.created_at.astimezone(timezone.utc)
        idx = int((ts - start).total_seconds() / slot) if slot else 0
        idx = min(max(idx, 0), buckets - 1)
        slot_row = slots[idx]
        slot_row["requests"] += 1
        slot_row["input_tokens"] += ev.input_tokens
        slot_row["output_tokens"] += ev.output_tokens
        slot_row["cost_usd"] = round(slot_row["cost_usd"] + float(ev.cost_usd), 6)
        if not ev.success:
            slot_row["errors"] += 1
        if ev.latency_ms is not None and ev.success:
            slot_row["latency_ms_sum"] += ev.latency_ms
            slot_row["latency_count"] += 1

    for row in slots:
        row["avg_latency_ms"] = round(row["latency_ms_sum"] / row["latency_count"], 1) if row["latency_count"] else 0.0
        row["cost_usd"] = round(row["cost_usd"], 4)
        del row["latency_ms_sum"]
        del row["latency_count"]

    return slots


def _group_breakdown(events: list[LlmUsageEvent], group_by: GroupKey) -> list[dict]:
    if group_by == "none":
        return []

    groups: dict[str, list[LlmUsageEvent]] = {}
    for ev in events:
        key = ev.model if group_by == "model" else ev.provider
        groups.setdefault(key, []).append(ev)

    rows = []
    for key, items in groups.items():
        st = _stats(items)
        rows.append({"key": key, **st})
    rows.sort(key=lambda r: r["requests"], reverse=True)
    return rows


async def _events_between(session: AsyncSession, start: datetime, end: datetime) -> list[LlmUsageEvent]:
    result = await session.execute(
        select(LlmUsageEvent)
        .where(LlmUsageEvent.created_at >= start, LlmUsageEvent.created_at < end)
        .order_by(LlmUsageEvent.created_at)
    )
    return list(result.scalars().all())


async def get_analytics(
    session: AsyncSession,
    *,
    range_key: str = "24h",
    group_by: str = "none",
) -> dict[str, Any]:
    if range_key not in RANGE_SECONDS:
        range_key = "24h"
    if group_by not in ("none", "model", "provider"):
        group_by = "none"

    now = datetime.now(timezone.utc)
    window = timedelta(seconds=RANGE_SECONDS[range_key])
    cur_start = now - window
    prev_start = now - window * 2
    prev_end = cur_start

    current_events = await _events_between(session, cur_start, now)
    previous_events = await _events_between(session, prev_start, prev_end)

    cur = _stats(current_events)
    prev = _stats(previous_events)
    buckets = BUCKET_COUNTS[range_key]
    timeseries = _bucketize(current_events, cur_start, now, buckets)

    def metric(value: float | int, prev_value: float | int) -> dict:
        return {"value": value, "change_pct": _pct_change(float(value), float(prev_value)), "previous": prev_value}

    return {
        "provider": "anthropic",
        "model": settings.anthropic_model,
        "configured": bool(settings.anthropic_api_key),
        "range": range_key,
        "group_by": group_by,
        "window_start": cur_start.isoformat(),
        "window_end": now.isoformat(),
        "metrics": {
            "total_requests": metric(cur["requests"], prev["requests"]),
            "total_cost": metric(cur["cost_usd"], prev["cost_usd"]),
            "avg_latency_ms": metric(cur["avg_latency_ms"], prev["avg_latency_ms"]),
            "error_rate_pct": metric(cur["error_rate_pct"], prev["error_rate_pct"]),
            "cache_hit_rate_pct": metric(cur["cache_hit_rate_pct"], prev["cache_hit_rate_pct"]),
        },
        "totals": cur,
        "timeseries": timeseries,
        "groups": _group_breakdown(current_events, group_by),  # type: ignore[arg-type]
        "pricing": {
            "input_per_mtok_usd": settings.anthropic_input_price_per_mtok,
            "output_per_mtok_usd": settings.anthropic_output_price_per_mtok,
        },
        "generated_at": now.isoformat(),
    }


async def get_cost_summary(session: AsyncSession) -> dict[str, Any]:
    return await get_analytics(session, range_key="30d", group_by="none")


async def ensure_usage_table() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(LlmUsageEvent.__table__.create, checkfirst=True)
        await conn.execute(text("ALTER TABLE llm_usage_events ADD COLUMN IF NOT EXISTS latency_ms DOUBLE PRECISION"))
        await conn.execute(
            text("ALTER TABLE llm_usage_events ADD COLUMN IF NOT EXISTS success BOOLEAN NOT NULL DEFAULT TRUE")
        )
