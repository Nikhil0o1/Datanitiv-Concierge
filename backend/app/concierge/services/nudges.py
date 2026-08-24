"""Concierge nudge delivery — proactive user-facing recommendations."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.concierge.models import ConciergeIncident, ConciergeNudge, ConciergeRecommendation
from app.concierge.services.incident_presentation import incident_priority, incident_title
from app.concierge.services.nudge_policy import filter_nudges_for_user_session, incident_nudge_suppressed
from app.concierge.services.sessionization import is_synthetic_session

logger = logging.getLogger("concierge.nudges")


async def create_nudge_for_recommendation(
    session: AsyncSession,
    incident: ConciergeIncident,
    recommendation: ConciergeRecommendation,
) -> ConciergeNudge | None:
    if recommendation.rank != 1:
        return None

    if await incident_nudge_suppressed(session, incident.id):
        return None

    existing = (
        await session.execute(
            select(ConciergeNudge).where(ConciergeNudge.recommendation_id == recommendation.id)
        )
    ).scalar_one_or_none()
    if existing:
        return existing

    cap_id = recommendation.cap_id or incident.cap_id or (incident.signals or {}).get("cap_id")

    pending_same_incident = (
        await session.execute(
            select(ConciergeNudge).where(
                ConciergeNudge.incident_id == incident.id,
                ConciergeNudge.status.in_(("pending", "shown")),
            )
        )
    ).scalar_one_or_none()
    if pending_same_incident:
        return None

    if cap_id and recommendation.domain in ("wfm", "operational", "friction"):
        pending_same_cap = (
            await session.execute(
                select(ConciergeNudge).where(
                    ConciergeNudge.cap_id == cap_id,
                    ConciergeNudge.status.in_(("pending", "shown")),
                    ConciergeNudge.domain == recommendation.domain,
                )
            )
        ).scalar_one_or_none()
        if pending_same_cap:
            return None

    summary = recommendation.rationale
    if recommendation.explanation:
        summary = recommendation.explanation.split("\n\n")[0][:500]

    nudge = ConciergeNudge(
        recommendation_id=recommendation.id,
        incident_id=incident.id,
        cap_id=cap_id,
        program=recommendation.program or (incident.signals or {}).get("program"),
        domain=recommendation.domain or "wfm",
        title=incident_title(incident),
        summary=summary,
        explanation=recommendation.explanation,
        reliability_score=recommendation.reliability_score,
        reliability_factors=recommendation.reliability_factors or {},
        ui_actions=recommendation.ui_actions or [],
        priority=incident_priority(incident),
        status="pending",
    )
    session.add(nudge)
    await session.flush()
    logger.info("Created nudge %s for cap=%s type=%s", nudge.id, cap_id, incident.incident_type)
    return nudge


async def list_pending_nudges(
    session: AsyncSession,
    limit: int = 10,
    user_session_id: str | None = None,
) -> list[ConciergeNudge]:
    now = datetime.now(timezone.utc)
    q = (
        select(ConciergeNudge)
        .where(
            ConciergeNudge.status.in_(("pending", "shown")),
            or_(ConciergeNudge.snoozed_until.is_(None), ConciergeNudge.snoozed_until <= now),
        )
        .order_by(ConciergeNudge.priority.desc(), ConciergeNudge.created_at.desc())
        .limit(max(limit * 3, limit))
    )
    rows = list((await session.execute(q)).scalars().all())
    if not rows:
        return []

    if user_session_id:
        rows = await filter_nudges_for_user_session(session, rows, user_session_id)
    else:
        incident_ids = {n.incident_id for n in rows}
        incidents = {
            i.id: i
            for i in (
                await session.execute(select(ConciergeIncident).where(ConciergeIncident.id.in_(incident_ids)))
            ).scalars()
        }
        rows = [
            n
            for n in rows
            if not (
                (inc := incidents.get(n.incident_id))
                and inc.incident_type in ("USER_FRICTION", "SESSION_ABANDONED")
                and is_synthetic_session((inc.signals or {}).get("session_id"))
            )
        ]

    return rows[:limit]


async def get_nudge(session: AsyncSession, nudge_id: UUID) -> ConciergeNudge | None:
    return (await session.execute(select(ConciergeNudge).where(ConciergeNudge.id == nudge_id))).scalar_one_or_none()


async def mark_nudge_shown(session: AsyncSession, nudge_id: UUID) -> ConciergeNudge | None:
    nudge = await get_nudge(session, nudge_id)
    if not nudge:
        return None
    if nudge.status == "pending":
        nudge.status = "shown"
    nudge.shown_at = datetime.now(timezone.utc)
    nudge.updated_at = datetime.now(timezone.utc)
    await session.commit()
    return nudge


async def dismiss_nudge(session: AsyncSession, nudge_id: UUID) -> ConciergeNudge | None:
    from app.concierge.services.incidents import resolve_incident

    nudge = await get_nudge(session, nudge_id)
    if not nudge:
        return None
    nudge.status = "dismissed"
    nudge.dismissed_at = datetime.now(timezone.utc)
    nudge.updated_at = datetime.now(timezone.utc)
    await resolve_incident(session, nudge.incident_id, resolved=True)
    await session.commit()
    return nudge


async def accept_nudge(session: AsyncSession, nudge_id: UUID) -> ConciergeNudge | None:
    nudge = await get_nudge(session, nudge_id)
    if not nudge:
        return None
    nudge.status = "accepted"
    nudge.accepted_at = datetime.now(timezone.utc)
    nudge.updated_at = datetime.now(timezone.utc)
    await session.commit()
    return nudge


async def snooze_nudge(session: AsyncSession, nudge_id: UUID, minutes: int | None = None) -> ConciergeNudge | None:
    nudge = await get_nudge(session, nudge_id)
    if not nudge:
        return None
    mins = minutes or settings.concierge_nudge_snooze_minutes
    nudge.status = "pending"
    nudge.snoozed_until = datetime.now(timezone.utc) + timedelta(minutes=mins)
    nudge.updated_at = datetime.now(timezone.utc)
    await session.commit()
    return nudge
