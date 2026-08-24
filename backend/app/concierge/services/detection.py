"""Rule and threshold detection engine."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.concierge.models import ConciergeDetectionResult, ConciergeDetectionRule, ConciergeEvent
from app.concierge.services.baselines import compute_error_rate, get_baseline


DEFAULT_RULES = [
    {
        "name": "repeated_api_failures",
        "rule_type": "threshold",
        "feature": "api",
        "config": {"event_type": "api_error", "min_count": 3, "window_minutes": 10},
    },
    {
        "name": "shrinkage_submit_failures",
        "rule_type": "threshold",
        "feature": "shrinkage",
        "config": {"event_type": "plan.shrinkage.failed", "min_count": 3, "window_minutes": 10},
    },
    {
        "name": "queue_execute_failures",
        "rule_type": "threshold",
        "feature": "queue",
        "config": {"event_type": "queue.execute.failed", "min_count": 2, "window_minutes": 10},
    },
    {
        "name": "agent_chat_failures",
        "rule_type": "threshold",
        "feature": "agent_chat",
        "config": {"event_type": "agent.chat.failed", "min_count": 2, "window_minutes": 15},
    },
    {
        "name": "roster_map_failures",
        "rule_type": "threshold",
        "feature": "roster",
        "config": {"event_type": "plan.roster.failed", "min_count": 2, "window_minutes": 15},
    },
    {
        "name": "error_rate_spike",
        "rule_type": "baseline_deviation",
        "feature": "api",
        "config": {"baseline_multiplier": 5.0, "min_absolute_rate": 0.1, "window_minutes": 10},
    },
]


async def ensure_default_rules(session: AsyncSession) -> None:
    for spec in DEFAULT_RULES:
        existing = (
            await session.execute(select(ConciergeDetectionRule).where(ConciergeDetectionRule.name == spec["name"]))
        ).scalar_one_or_none()
        if not existing:
            session.add(ConciergeDetectionRule(**spec))


async def run_detection(session: AsyncSession, event: ConciergeEvent) -> list[ConciergeDetectionResult]:
    rules = (
        await session.execute(select(ConciergeDetectionRule).where(ConciergeDetectionRule.enabled.is_(True)))
    ).scalars().all()

    results: list[ConciergeDetectionResult] = []
    for rule in rules:
        result = await _evaluate_rule(session, rule, event)
        if result:
            session.add(result)
            results.append(result)
    return results


async def _evaluate_rule(
    session: AsyncSession,
    rule: ConciergeDetectionRule,
    event: ConciergeEvent,
) -> ConciergeDetectionResult | None:
    if rule.rule_type == "threshold":
        return await _threshold_rule(session, rule, event)
    if rule.rule_type == "baseline_deviation":
        return await _baseline_deviation_rule(session, rule, event)
    return None


async def _threshold_rule(
    session: AsyncSession,
    rule: ConciergeDetectionRule,
    event: ConciergeEvent,
) -> ConciergeDetectionResult | None:
    cfg = rule.config
    event_type = cfg.get("event_type")
    if event.event_type != event_type and not (event_type == "api_error" and event.event_type == "api_request" and (event.status_code or 0) >= 500):
        if event_type == "api_error" and event.event_type == "api_error":
            pass
        elif event.event_type != event_type:
            return None

    window = cfg.get("window_minutes", 10)
    since = datetime.now(timezone.utc) - timedelta(minutes=window)
    min_count = cfg.get("min_count", 3)

    q = select(ConciergeEvent).where(ConciergeEvent.timestamp >= since)
    if event_type == "api_error":
        q = q.where(
            (ConciergeEvent.event_type == "api_error")
            | ((ConciergeEvent.event_type == "api_request") & (ConciergeEvent.status_code >= 500))
        )
    else:
        q = q.where(ConciergeEvent.event_type == event_type)

    if event.session_id:
        q = q.where(ConciergeEvent.session_id == event.session_id)

    events = (await session.execute(q.order_by(ConciergeEvent.timestamp.desc()).limit(min_count + 5))).scalars().all()
    if len(events) < min_count:
        return None

    evidence_ids = [str(e.event_id) for e in events[:min_count]]
    meta = event.metadata_ or {}
    return ConciergeDetectionResult(
        rule_id=rule.id,
        rule_name=rule.name,
        feature=rule.feature,
        severity="high" if min_count >= 3 else "medium",
        signal_summary={
            "failed_attempts": len(events),
            "error_type": event.error_code or event.event_type,
            "affected_feature": rule.feature,
            "window_minutes": window,
            "cap_id": meta.get("cap_id") or meta.get("active_cap_id"),
            "active_tab": meta.get("active_tab"),
        },
        evidence_event_ids=evidence_ids,
        session_id=event.session_id,
    )


async def _baseline_deviation_rule(
    session: AsyncSession,
    rule: ConciergeDetectionRule,
    event: ConciergeEvent,
) -> ConciergeDetectionResult | None:
    if event.event_type not in ("api_error", "api_request"):
        return None
    if event.event_type == "api_request" and (event.status_code or 0) < 400:
        return None

    cfg = rule.config
    window = cfg.get("window_minutes", 10)
    current_rate = await compute_error_rate(session, rule.feature, window)
    baseline = await get_baseline(session, rule.feature, "error_count", event.tenant_id)

    baseline_rate = 0.005
    if baseline and baseline.sample_count > 10:
        req_baseline = await get_baseline(session, rule.feature, "request_count", event.tenant_id)
        if req_baseline and req_baseline.mean_value > 0:
            baseline_rate = baseline.mean_value / max(req_baseline.mean_value, 1)

    multiplier = cfg.get("baseline_multiplier", 5.0)
    min_absolute = cfg.get("min_absolute_rate", 0.1)

    if current_rate < min_absolute:
        return None
    if current_rate < baseline_rate * multiplier:
        return None

    return ConciergeDetectionResult(
        rule_id=rule.id,
        rule_name=rule.name,
        feature=rule.feature,
        severity="high",
        signal_summary={
            "current_error_rate": round(current_rate, 4),
            "baseline_error_rate": round(baseline_rate, 4),
            "deviation_multiplier": round(current_rate / max(baseline_rate, 0.001), 2),
        },
        evidence_event_ids=[str(event.event_id)],
        session_id=event.session_id,
    )
