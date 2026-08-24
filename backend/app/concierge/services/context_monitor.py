"""Context-aware nudges when user is viewing a plan that has open WFM issues."""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.concierge.models import ConciergeEvent, ConciergeIncident, ConciergeRecommendation
from app.concierge.services.cases import find_similar_cases
from app.concierge.services.incident_presentation import ui_actions_for_incident
from app.concierge.services.incidents import mark_recommendation_available
from app.concierge.services.llm import generate_explanation
from app.concierge.services.nudge_policy import should_nudge_for_user_context
from app.concierge.services.nudges import create_nudge_for_recommendation
from app.concierge.services.recommendations import generate_recommendations

logger = logging.getLogger("concierge.context_monitor")


async def maybe_nudge_for_user_context(session: AsyncSession, event: ConciergeEvent) -> bool:
    """If user navigates to a cap plan with an open WFM incident, ensure a contextual nudge exists."""
    meta = event.metadata_ or {}
    cap_id = meta.get("cap_id") or meta.get("active_cap_id")
    if not cap_id:
        return False

    incident = (
        await session.execute(
            select(ConciergeIncident)
            .where(
                ConciergeIncident.cap_id == cap_id,
                ConciergeIncident.status.notin_(("RESOLVED", "ESCALATED")),
                ConciergeIncident.incident_type.notin_(("USER_FRICTION", "SESSION_ABANDONED")),
            )
            .order_by(ConciergeIncident.updated_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if not incident:
        return False

    if not await should_nudge_for_user_context(session, event=event, incident=incident):
        return False

    existing_rec = (
        await session.execute(
            select(ConciergeRecommendation)
            .where(ConciergeRecommendation.incident_id == incident.id, ConciergeRecommendation.rank == 1)
            .limit(1)
        )
    ).scalar_one_or_none()

    if existing_rec:
        rec = existing_rec
        rec.ui_actions = ui_actions_for_incident(incident.incident_type, incident.signals or {})
    else:
        recs = await generate_recommendations(session, incident)
        if not recs:
            return False
        rec = recs[0]
        signals = incident.signals or {}
        rec.cap_id = cap_id
        rec.program = signals.get("program")
        rec.domain = "wfm"
        rec.ui_actions = ui_actions_for_incident(incident.incident_type, signals)
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
    if nudge:
        nudge.priority = min(95, nudge.priority + 10)
        logger.info("Context nudge for cap=%s tab=%s", cap_id, meta.get("active_tab"))
        return True
    return False
