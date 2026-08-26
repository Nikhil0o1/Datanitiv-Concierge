"""Detect user difficulty from session patterns. Incidents stay silent — no user cards."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.concierge.models import ConciergeSession
from app.concierge.services.incidents import upsert_session_incident
from app.concierge.services.nudge_policy import session_has_real_user_activity
from app.concierge.services.sessionization import is_synthetic_session

logger = logging.getLogger("concierge.friction_monitor")


async def run_friction_monitor(session: AsyncSession) -> int:
    """Scan active sessions for struggle patterns; record incidents without nudging."""
    since = datetime.now(timezone.utc) - timedelta(minutes=45)
    rows = (
        await session.execute(
            select(ConciergeSession).where(
                ConciergeSession.last_event_at >= since,
                ConciergeSession.resolved.is_(False),
            )
        )
    ).scalars().all()

    incidents_created = 0
    for row in rows:
        if is_synthetic_session(row.session_id):
            continue
        if not await session_has_real_user_activity(session, row.session_id):
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
        if incident and is_new:
            incidents_created += 1

    if incidents_created:
        logger.info("Friction monitor recorded %d silent incidents", incidents_created)
    return incidents_created
