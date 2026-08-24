"""Detect user difficulty from session patterns and surface Concierge nudges."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.concierge.models import ConciergeIncident, ConciergeSession
from app.concierge.services.cases import find_similar_cases
from app.concierge.services.incident_presentation import ui_actions_for_incident
from app.concierge.services.incidents import mark_recommendation_available, upsert_session_incident
from app.concierge.services.llm import generate_explanation
from app.concierge.services.nudges import create_nudge_for_recommendation
from app.concierge.services.recommendations import generate_recommendations
from app.concierge.services.nudge_policy import should_nudge_for_friction_session
from app.concierge.services.sessionization import is_synthetic_session

logger = logging.getLogger("concierge.friction_monitor")


async def run_friction_monitor(session: AsyncSession) -> int:
    """Scan active sessions for struggle patterns; create friction incidents + nudges."""
    since = datetime.now(timezone.utc) - timedelta(minutes=45)
    rows = (
        await session.execute(
            select(ConciergeSession).where(
                ConciergeSession.last_event_at >= since,
                ConciergeSession.resolved.is_(False),
            )
        )
    ).scalars().all()

    nudges_created = 0
    for row in rows:
        if is_synthetic_session(row.session_id):
            continue
        if not await should_nudge_for_friction_session(session, row):
            continue

        incident_type = None
        why = None

        if row.abandoned and row.error_count >= 2:
            incident_type = "SESSION_ABANDONED"
            why = f"Left workflow after {row.error_count} errors"
        elif row.error_count >= 3:
            incident_type = "USER_FRICTION"
            why = f"{row.error_count} errors in current session on {row.feature or 'platform'}"
        elif row.event_count >= 25 and row.error_count >= 1 and not row.resolved:
            incident_type = "USER_FRICTION"
            why = f"High activity ({row.event_count} events) with errors on {row.feature or 'platform'}"

        if not incident_type:
            continue

        signals = {
            "session_id": row.session_id,
            "feature": row.feature,
            "error_count": row.error_count,
            "event_count": row.event_count,
            "why": why,
            "cap_id": (row.summary or {}).get("active_cap_id"),
            "active_tab": (row.summary or {}).get("active_tab"),
        }

        incident, is_new = await upsert_session_incident(session, incident_type, signals)
        if not incident:
            continue

        recs = await generate_recommendations(session, incident)
        if not recs:
            continue

        rec = recs[0]
        rec.domain = "friction"
        rec.cap_id = signals.get("cap_id")
        rec.ui_actions = ui_actions_for_incident(incident_type, signals)

        similar = await find_similar_cases(session, incident)
        similar_dicts = [
            {
                "summary": c.summary_text,
                "resolution": c.resolution,
                "outcome": c.outcome,
                "similarity": round(s, 3),
            }
            for c, s in similar
        ]
        await generate_explanation(session, incident, rec, similar_dicts)
        await mark_recommendation_available(session, incident.id)

        nudge = await create_nudge_for_recommendation(session, incident, rec)
        if nudge and is_new:
            nudges_created += 1

    if nudges_created:
        logger.info("Friction monitor created %d nudges", nudges_created)
    return nudges_created
