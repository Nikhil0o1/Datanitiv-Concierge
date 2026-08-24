"""Shared incident → recommendation → nudge pipeline."""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.concierge.models import ConciergeIncident, ConciergeRecommendation
from app.concierge.services.cases import find_similar_cases
from app.concierge.services.incident_presentation import ui_actions_for_incident
from app.concierge.services.incidents import mark_recommendation_available
from app.concierge.services.llm import generate_explanation
from app.concierge.services.metrics import worker_metrics
from app.concierge.services.nudges import create_nudge_for_recommendation
from app.concierge.services.recommendations import generate_recommendations


async def finalize_incident_with_nudge(
    session: AsyncSession,
    incident: ConciergeIncident,
    *,
    domain: str = "operational",
    signals: dict[str, Any] | None = None,
) -> ConciergeRecommendation | None:
    """Generate top recommendation, explanation, and user-facing nudge for an incident."""
    sig = signals or incident.signals or {}
    recs = await generate_recommendations(session, incident)
    if not recs:
        return None

    rec = recs[0]
    rec.domain = domain
    rec.cap_id = sig.get("cap_id") or incident.cap_id
    rec.program = sig.get("program")
    rec.ui_actions = ui_actions_for_incident(incident.incident_type, sig)

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
        worker_metrics.recommendations_created += 1
    return rec
