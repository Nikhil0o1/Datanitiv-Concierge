"""Baseline calculation — rolling normal behavior per feature/metric."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.concierge.models import ConciergeBaseline, ConciergeEvent


async def update_baselines(session: AsyncSession, event: ConciergeEvent) -> None:
    feature = _feature_for_event(event)
    if not feature:
        return

    if event.latency_ms is not None and event.event_type == "api_request":
        await _update_metric(session, feature, "latency_ms", event.latency_ms, event.tenant_id)

    if event.event_type in ("api_error", "api_request") and event.status_code and event.status_code >= 400:
        await _update_metric(session, feature, "error_count", 1.0, event.tenant_id)
    elif event.event_type == "api_request":
        await _update_metric(session, feature, "request_count", 1.0, event.tenant_id)

    if event.event_type.endswith(".failed"):
        await _update_metric(session, feature, "failure_count", 1.0, event.tenant_id)


async def get_baseline(session: AsyncSession, feature: str, metric: str, tenant_id: str | None = None) -> ConciergeBaseline | None:
    q = select(ConciergeBaseline).where(
        ConciergeBaseline.feature == feature,
        ConciergeBaseline.metric == metric,
    )
    if tenant_id:
        q = q.where(ConciergeBaseline.tenant_id == tenant_id)
    return (await session.execute(q)).scalar_one_or_none()


async def compute_error_rate(session: AsyncSession, feature: str, window_minutes: int = 10) -> float:
    since = datetime.now(timezone.utc) - timedelta(minutes=window_minutes)
    feature_events = FEATURE_EVENT_TYPES.get(feature, [])
    if not feature_events:
        return 0.0

    total = (
        await session.execute(
            select(func.count())
            .select_from(ConciergeEvent)
            .where(ConciergeEvent.timestamp >= since, ConciergeEvent.event_type.in_(feature_events))
        )
    ).scalar_one()

    errors = (
        await session.execute(
            select(func.count())
            .select_from(ConciergeEvent)
            .where(
                ConciergeEvent.timestamp >= since,
                ConciergeEvent.event_type.in_(feature_events),
                ConciergeEvent.severity.in_(("error", "critical")),
            )
        )
    ).scalar_one()

    if total == 0:
        return 0.0
    return errors / total


FEATURE_EVENT_TYPES = {
    "shrinkage": ["plan.shrinkage.submitted", "plan.shrinkage.failed"],
    "queue": ["queue.executed", "queue.execute.failed"],
    "agent_chat": ["agent.chat.completed", "agent.chat.failed"],
    "api": ["api_request", "api_error"],
}


def _feature_for_event(event: ConciergeEvent) -> str | None:
    from app.concierge.services.sessionization import FEATURE_MAP

    if event.endpoint:
        if "shrinkage" in event.endpoint:
            return "shrinkage"
        if "queue" in event.endpoint or "execute" in event.endpoint:
            return "queue"
        if "agent" in event.endpoint:
            return "agent_chat"
    return FEATURE_MAP.get(event.event_type)


async def _update_metric(
    session: AsyncSession,
    feature: str,
    metric: str,
    value: float,
    tenant_id: str | None,
) -> None:
    row = await get_baseline(session, feature, metric, tenant_id)
    if row is None:
        row = ConciergeBaseline(feature=feature, metric=metric, tenant_id=tenant_id, sample_count=1, mean_value=value)
        session.add(row)
        return

    n = row.sample_count
    new_mean = (row.mean_value * n + value) / (n + 1)
    if n > 1:
        variance = row.std_value**2
        new_variance = ((n - 1) * variance + (value - new_mean) ** 2) / n
        row.std_value = new_variance**0.5
    row.mean_value = new_mean
    row.sample_count = n + 1
    if value > row.p95_value:
        row.p95_value = value
    row.updated_at = datetime.now(timezone.utc)
