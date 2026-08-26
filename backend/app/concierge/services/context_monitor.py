"""Context-aware nudges when user is viewing a plan that has open WFM issues."""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.concierge.models import ConciergeEvent, ConciergeIncident
from app.concierge.services.incident_pipeline import attach_explanation
from app.concierge.services.incident_presentation import ui_actions_for_incident
from app.concierge.services.incidents import mark_recommendation_available
from app.concierge.services.nudge_policy import WFM_INCIDENT_TYPES, should_nudge_for_user_context
from app.concierge.services.nudges import create_nudge_for_recommendation
from app.concierge.services.recommendations import generate_recommendations
from app.concierge.services.wfm_actions import wfm_priority

logger = logging.getLogger("concierge.context_monitor")


async def maybe_nudge_for_user_context(session: AsyncSession, event: ConciergeEvent) -> bool:
    """If user navigates to a cap plan with an open WFM incident, ensure a contextual nudge exists."""
    meta = event.metadata_ or {}
    cap_id = meta.get("cap_id") or meta.get("active_cap_id")
    if not cap_id:
        return False

    incidents = (
        await session.execute(
            select(ConciergeIncident).where(
                ConciergeIncident.cap_id == cap_id,
                ConciergeIncident.status.notin_(("RESOLVED", "ESCALATED")),
                ConciergeIncident.incident_type.in_(tuple(WFM_INCIDENT_TYPES)),
            )
        )
    ).scalars().all()
    if not incidents:
        return False

    incidents = sorted(
        incidents,
        key=lambda inc: wfm_priority(inc.incident_type, inc.signals or {}),
        reverse=True,
    )

    for incident in incidents:
        if not await should_nudge_for_user_context(session, event=event, incident=incident):
            continue

        recs = await generate_recommendations(session, incident)
        if not recs:
            continue
        rec = recs[0]
        signals = incident.signals or {}
        rec.cap_id = cap_id
        rec.program = signals.get("program")
        rec.domain = "wfm"
        rec.ui_actions = ui_actions_for_incident(incident.incident_type, signals)
        await mark_recommendation_available(session, incident.id)

        nudge = await create_nudge_for_recommendation(
            session, incident, rec, user_session_id=event.session_id
        )
        if not nudge:
            continue

        nudge.priority = min(95, nudge.priority + 10)
        await attach_explanation(session, incident, rec, nudge)
        logger.info("Context nudge for cap=%s type=%s tab=%s", cap_id, incident.incident_type, meta.get("active_tab"))
        return True

    return False


async def ensure_nudge_for_open_plan(
    session: AsyncSession,
    *,
    cap_id: str,
    session_id: str | None,
) -> bool:
    """Create a WFM card for the plan currently on screen, without waiting on the event queue."""
    if not cap_id or not session_id:
        return False
    from datetime import datetime, timezone
    from uuid import uuid4

    event = ConciergeEvent(
        event_id=uuid4(),
        timestamp=datetime.now(timezone.utc),
        session_id=session_id,
        event_type="plan.opened",
        source="frontend",
        service="planning-ui",
        severity="info",
        metadata_={"cap_id": cap_id, "active_cap_id": cap_id, "view": "plan", "source": "pending-poll"},
    )
    return await maybe_nudge_for_user_context(session, event)
