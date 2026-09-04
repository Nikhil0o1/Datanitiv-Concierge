"""Concierge nudge delivery — proactive user-facing recommendations."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.concierge.models import ConciergeIncident, ConciergeNudge, ConciergeRecommendation, ConciergeSession
from app.concierge.services.incident_presentation import incident_priority, incident_title
from app.concierge.services.metrics import worker_metrics
from app.concierge.services.nudge_policy import (
    WFM_ACTION_OPERATIONAL_TYPES,
    WFM_INCIDENT_TYPES,
    filter_nudges_for_user_session,
    incident_nudge_suppressed,
    mark_session_wfm_nudge,
    reliability_allows_nudge,
    type_nudge_suppressed,
    wfm_session_budget_exhausted,
)
from app.concierge.services.sessionization import is_synthetic_session

logger = logging.getLogger("concierge.nudges")


async def create_nudge_for_recommendation(
    session: AsyncSession,
    incident: ConciergeIncident,
    recommendation: ConciergeRecommendation,
    *,
    user_session_id: str | None = None,
) -> ConciergeNudge | None:
    if recommendation.rank != 1:
        return None

    if await incident_nudge_suppressed(session, incident.id):
        worker_metrics.nudges_suppressed += 1
        return None

    cap_id = recommendation.cap_id or incident.cap_id or (incident.signals or {}).get("cap_id")
    if await type_nudge_suppressed(session, incident.incident_type, cap_id):
        worker_metrics.nudges_suppressed += 1
        logger.info("Suppressed nudge type=%s cap=%s (dismissed twice)", incident.incident_type, cap_id)
        return None

    if not reliability_allows_nudge(incident, recommendation.reliability_score or 0.0):
        worker_metrics.nudges_blocked_low_reliability += 1
        logger.info(
            "Blocked low-reliability nudge type=%s score=%.2f",
            incident.incident_type,
            recommendation.reliability_score or 0.0,
        )
        return None

    existing = (
        await session.execute(
            select(ConciergeNudge).where(ConciergeNudge.recommendation_id == recommendation.id)
        )
    ).scalar_one_or_none()
    if existing:
        if existing.status in ("pending", "shown"):
            return existing
        if existing.status == "accepted":
            # Unique on recommendation_id — reopen the card after cooldown instead of inserting.
            existing.status = "pending"
            existing.shown_at = None
            existing.accepted_at = None
            existing.dismissed_at = None
            existing.snoozed_until = None
            existing.title = incident_title(incident)
            existing.summary = (
                (recommendation.explanation.split("\n\n")[0][:500] if recommendation.explanation else None)
                or recommendation.rationale
            )
            existing.explanation = recommendation.explanation
            existing.reliability_score = recommendation.reliability_score
            existing.reliability_factors = recommendation.reliability_factors or {}
            existing.ui_actions = recommendation.ui_actions or []
            existing.priority = incident_priority(incident)
            await session.flush()
            worker_metrics.nudges_created += 1
            logger.info("Reopened nudge %s for cap=%s", existing.id, cap_id)
            if recommendation.domain == "wfm" and user_session_id:
                await mark_session_wfm_nudge(session, user_session_id)
            return existing
        return None

    pending_same_incident = (
        await session.execute(
            select(ConciergeNudge).where(
                ConciergeNudge.incident_id == incident.id,
                ConciergeNudge.status.in_(("pending", "shown")),
            )
        )
    ).scalar_one_or_none()
    if pending_same_incident:
        worker_metrics.nudges_suppressed += 1
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
            worker_metrics.nudges_suppressed += 1
            return None

    if recommendation.domain == "wfm" and user_session_id:
        if await wfm_session_budget_exhausted(session, user_session_id):
            worker_metrics.nudges_suppressed += 1
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
    worker_metrics.nudges_created += 1
    logger.info("Created nudge %s for cap=%s type=%s", nudge.id, cap_id, incident.incident_type)
    return nudge


async def list_pending_nudges(
    session: AsyncSession,
    limit: int = 10,
    user_session_id: str | None = None,
    cap_id: str | None = None,
    view: str | None = None,
) -> list[ConciergeNudge]:
    now = datetime.now(timezone.utc)
    live = (
        ConciergeNudge.status.in_(("pending", "shown")),
        or_(ConciergeNudge.snoozed_until.is_(None), ConciergeNudge.snoozed_until <= now),
    )

    if user_session_id:
        if is_synthetic_session(user_session_id):
            return []
        user_sess = (
            await session.execute(select(ConciergeSession).where(ConciergeSession.session_id == user_session_id))
        ).scalar_one_or_none()
        active_cap = cap_id or ((user_sess.summary or {}).get("active_cap_id") if user_sess else None)
        current_view = view if view is not None else ((user_sess.summary or {}).get("view") if user_sess else None)

        ops_types = tuple(WFM_ACTION_OPERATIONAL_TYPES)
        relevance = [
            and_(
                ConciergeIncident.incident_type.in_(ops_types),
                ConciergeIncident.session_id == user_session_id,
            )
        ]
        if active_cap:
            relevance.append(
                and_(
                    or_(
                        ConciergeIncident.incident_type.in_(tuple(WFM_INCIDENT_TYPES)),
                        ConciergeNudge.domain == "wfm",
                    ),
                    ConciergeNudge.cap_id == active_cap,
                )
            )

        q = (
            select(ConciergeNudge)
            .join(ConciergeIncident, ConciergeIncident.id == ConciergeNudge.incident_id)
            .where(*live, or_(*relevance))
            .order_by(ConciergeNudge.priority.desc(), ConciergeNudge.created_at.desc())
            .limit(max(limit * 3, 20))
        )
        rows = list((await session.execute(q)).scalars().all())
        rows = await filter_nudges_for_user_session(
            session,
            rows,
            user_session_id,
            cap_id=active_cap,
            view=current_view,
        )
        return rows[: max(1, settings.concierge_nudge_session_limit)]

    q = (
        select(ConciergeNudge)
        .where(*live)
        .order_by(ConciergeNudge.priority.desc(), ConciergeNudge.created_at.desc())
        .limit(max(limit * 3, limit))
    )
    rows = list((await session.execute(q)).scalars().all())
    if not rows:
        return []

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


async def mark_nudge_shown(
    session: AsyncSession,
    nudge_id: UUID,
    *,
    user_session_id: str | None = None,
) -> ConciergeNudge | None:
    nudge = await get_nudge(session, nudge_id)
    if not nudge:
        return None
    if nudge.status == "pending":
        nudge.status = "shown"
    nudge.shown_at = datetime.now(timezone.utc)
    nudge.updated_at = datetime.now(timezone.utc)
    if nudge.domain == "wfm":
        await mark_session_wfm_nudge(session, user_session_id)
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


async def dismiss_non_wfm_open_nudges(session: AsyncSession) -> int:
    """Close leftover demo/operational cards so only WFM planning nudges stay open."""
    now = datetime.now(timezone.utc)
    rows = (
        await session.execute(
            select(ConciergeNudge, ConciergeIncident)
            .join(ConciergeIncident, ConciergeIncident.id == ConciergeNudge.incident_id)
            .where(ConciergeNudge.status.in_(("pending", "shown")))
        )
    ).all()
    n = 0
    for nudge, incident in rows:
        if incident.incident_type in WFM_INCIDENT_TYPES:
            continue
        nudge.status = "dismissed"
        nudge.dismissed_at = now
        nudge.updated_at = now
        n += 1
    if n:
        logger.info("Dismissed %d non-WFM open nudges", n)
    return n


async def dismiss_all_open_nudges(session: AsyncSession) -> int:
    """One-shot inbox reset — close every pending/shown card."""
    now = datetime.now(timezone.utc)
    rows = (
        await session.execute(select(ConciergeNudge).where(ConciergeNudge.status.in_(("pending", "shown"))))
    ).scalars().all()
    for nudge in rows:
        nudge.status = "dismissed"
        nudge.dismissed_at = now
        nudge.updated_at = now
    if rows:
        logger.info("Reset Concierge inbox — dismissed %d open nudges", len(rows))
    return len(rows)


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
