"""Sessionization — group events into meaningful interaction sequences."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.concierge.models import ConciergeEvent, ConciergeSession

FEATURE_MAP = {
    "plan.shrinkage.submitted": "shrinkage",
    "plan.shrinkage.failed": "shrinkage",
    "plan.roster.mapped": "roster",
    "plan.roster.failed": "roster",
    "queue.executed": "queue",
    "queue.execute.failed": "queue",
    "agent.chat.failed": "agent_chat",
    "agent.chat.completed": "agent_chat",
    "api_error": "api",
    "api_request": "api",
    "view.changed": "navigation",
    "tab.changed": "navigation",
    "ui.context": "planning",
    "plan.opened": "planning",
}


async def update_session_for_event(session: AsyncSession, event: ConciergeEvent) -> None:
    if not event.session_id:
        return

    now = event.timestamp
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    feature = FEATURE_MAP.get(event.event_type)
    row = (
        await session.execute(select(ConciergeSession).where(ConciergeSession.session_id == event.session_id))
    ).scalar_one_or_none()

    is_error = event.severity in ("error", "critical") or event.event_type.endswith(".failed") or event.event_type == "api_error"

    if row is None:
        row = ConciergeSession(
            session_id=event.session_id,
            tenant_id=event.tenant_id,
            user_id=event.user_id,
            feature=feature,
            started_at=now,
            last_event_at=now,
            event_count=1,
            error_count=1 if is_error else 0,
        )
        session.add(row)
    else:
        row.last_event_at = now
        row.event_count += 1
        if is_error:
            row.error_count += 1
        if feature and not row.feature:
            row.feature = feature
        if event.user_id and not row.user_id:
            row.user_id = event.user_id

    if event.event_type.endswith(".completed") or event.event_type == "queue.executed":
        row.resolved = True
    if event.event_type == "view.changed" and event.metadata_.get("to_view") == "port" and row.error_count >= 3:
        row.abandoned = True
    if row.error_count >= 3 and event.event_type in ("plan.shrinkage.failed", "plan.roster.failed", "queue.execute.failed"):
        row.abandoned = False

    meta = event.metadata_ or {}
    prev = row.summary or {}
    summary = {
        "feature": row.feature,
        "event_count": row.event_count,
        "error_count": row.error_count,
        "last_event_type": event.event_type,
        "active_cap_id": meta.get("cap_id") or meta.get("active_cap_id") or prev.get("active_cap_id"),
        "active_tab": meta.get("active_tab") or prev.get("active_tab"),
        "view": meta.get("view") or prev.get("view"),
    }
    row.summary = summary


def is_synthetic_session(session_id: str | None) -> bool:
    """True for pytest / load-test sessions that should not trigger user-facing nudges."""
    if not session_id:
        return False
    sid = session_id.lower()
    markers = ("detect-test-", "dedup-test-", "pytest", "test-session", "load-test-")
    return any(m in sid for m in markers)
