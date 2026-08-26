"""Shared incident → recommendation → nudge pipeline."""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.concierge.models import ConciergeIncident, ConciergeNudge, ConciergeRecommendation
from app.concierge.services.cases import find_similar_cases
from app.concierge.services.incident_presentation import ui_actions_for_incident
from app.concierge.services.incidents import mark_recommendation_available
from app.concierge.services.llm import generate_explanation
from app.concierge.services.metrics import worker_metrics
from app.concierge.services.nudges import create_nudge_for_recommendation
from app.concierge.services.recommendations import generate_recommendations


async def attach_explanation(
    session: AsyncSession,
    incident: ConciergeIncident,
    recommendation: ConciergeRecommendation,
    nudge: ConciergeNudge | None = None,
) -> None:
    """LLM (or template fallback) explains an already-chosen recommendation. Never sets reliability."""
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
    await generate_explanation(session, incident, recommendation, similar_dicts)
    if nudge and recommendation.explanation:
        nudge.explanation = recommendation.explanation
        nudge.summary = recommendation.explanation.split("\n\n")[0][:500]


async def finalize_incident_with_nudge(
    session: AsyncSession,
    incident: ConciergeIncident,
    *,
    domain: str = "operational",
    signals: dict[str, Any] | None = None,
    user_session_id: str | None = None,
) -> ConciergeRecommendation | None:
    """Generate top recommendation, create the card, then optionally explain it."""
    sig = signals or incident.signals or {}
    recs = await generate_recommendations(session, incident)
    if not recs:
        return None

    rec = recs[0]
    rec.domain = domain
    rec.cap_id = sig.get("cap_id") or incident.cap_id
    rec.program = sig.get("program")
    rec.ui_actions = ui_actions_for_incident(incident.incident_type, sig)
    await mark_recommendation_available(session, incident.id)

    nudge = await create_nudge_for_recommendation(
        session, incident, rec, user_session_id=user_session_id
    )
    await attach_explanation(session, incident, rec, nudge)
    if nudge:
        worker_metrics.recommendations_created += 1
    return rec
