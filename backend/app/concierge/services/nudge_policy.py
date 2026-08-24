"""When Concierge may surface a user-facing nudge — issue-driven, not spam."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.concierge.models import ConciergeEvent, ConciergeIncident, ConciergeNudge, ConciergeSession
from app.concierge.services.sessionization import is_synthetic_session

# Only user navigation should trigger contextual WFM nudges (not passive telemetry).
USER_CONTEXT_EVENTS = frozenset(
    {
        "plan.opened",
        "tab.changed",
        "view.changed",
    }
)

OPERATIONAL_INCIDENT_TYPES = frozenset(
    {
        "SHRINKAGE_SUBMISSION_FAILURE",
        "QUEUE_EXECUTE_FAILURE",
        "AGENT_CHAT_FAILURE",
        "ROSTER_SUBMISSION_FAILURE",
        "API_FAILURE",
        "ERROR_RATE_SPIKE",
    }
)

FRICTION_INCIDENT_TYPES = frozenset({"USER_FRICTION", "SESSION_ABANDONED"})

WFM_INCIDENT_TYPES = frozenset(
    {
        "PLAN_SUSTAINED_UNDER",
        "PLAN_CRITICAL_SHORT",
        "PLAN_DECISION_REQUIRED",
        "SHRINKAGE_DRIFT",
        "ROSTER_GAP",
        "FORWARD_OU_RISK",
    }
)


async def incident_nudge_suppressed(session: AsyncSession, incident_id) -> bool:
    """True if the user already dismissed or accepted guidance for this incident."""
    row = (
        await session.execute(
            select(ConciergeNudge.id).where(
                ConciergeNudge.incident_id == incident_id,
                ConciergeNudge.status.in_(("dismissed", "accepted")),
            )
        )
    ).first()
    return row is not None


async def session_has_real_user_activity(session: AsyncSession, session_id: str | None) -> bool:
    if not session_id or is_synthetic_session(session_id):
        return False
    row = (
        await session.execute(
            select(ConciergeEvent.id)
            .where(
                ConciergeEvent.session_id == session_id,
                ConciergeEvent.source.in_(("frontend", "planning-ui")),
            )
            .limit(1)
        )
    ).first()
    return row is not None


async def should_nudge_for_detection_event(
    session: AsyncSession,
    *,
    event,
    incident: ConciergeIncident,
    is_new_incident: bool,
) -> bool:
    """Operational nudges only for real user sessions with a fresh incident."""
    if not is_new_incident:
        return False
    if is_synthetic_session(event.session_id):
        return False
    if incident.incident_type not in OPERATIONAL_INCIDENT_TYPES:
        return False
    if await incident_nudge_suppressed(session, incident.id):
        return False
    if not await session_has_real_user_activity(session, event.session_id):
        return False
    return True


async def should_nudge_for_user_context(
    session: AsyncSession,
    *,
    event,
    incident: ConciergeIncident,
) -> bool:
    """WFM nudges only when the user navigates to a plan with a known issue."""
    if event.event_type not in USER_CONTEXT_EVENTS:
        return False
    if is_synthetic_session(event.session_id):
        return False
    if incident.incident_type not in WFM_INCIDENT_TYPES:
        return False
    if await incident_nudge_suppressed(session, incident.id):
        return False

    meta = event.metadata_ or {}
    cap_id = meta.get("cap_id") or meta.get("active_cap_id")
    if not cap_id or cap_id != incident.cap_id:
        return False

    # Portfolio landing — no nudge until they open a specific plan.
    if event.event_type == "view.changed" and meta.get("to_view") == "port":
        return False
    if meta.get("view") == "port" and event.event_type != "plan.opened":
        return False

    return True


async def should_nudge_for_friction_session(
    session: AsyncSession,
    row: ConciergeSession,
) -> bool:
    if is_synthetic_session(row.session_id):
        return False
    if row.error_count < 3:
        return False
    if not await session_has_real_user_activity(session, row.session_id):
        return False
    return True


async def filter_nudges_for_user_session(
    session: AsyncSession,
    nudges: list[ConciergeNudge],
    user_session_id: str | None,
) -> list[ConciergeNudge]:
    """Return only nudges relevant to this browser session."""
    if not user_session_id or is_synthetic_session(user_session_id):
        return []

    incidents = {
        i.id: i
        for i in (
            await session.execute(
                select(ConciergeIncident).where(
                    ConciergeIncident.id.in_({n.incident_id for n in nudges})
                )
            )
        ).scalars()
    }

    user_sess = (
        await session.execute(select(ConciergeSession).where(ConciergeSession.session_id == user_session_id))
    ).scalar_one_or_none()
    active_cap = (user_sess.summary or {}).get("active_cap_id") if user_sess else None

    filtered: list[ConciergeNudge] = []
    for nudge in nudges:
        incident = incidents.get(nudge.incident_id)
        if not incident:
            continue

        if incident.incident_type in FRICTION_INCIDENT_TYPES | OPERATIONAL_INCIDENT_TYPES:
            if incident.session_id != user_session_id:
                continue

        if incident.incident_type in WFM_INCIDENT_TYPES or nudge.domain == "wfm":
            if not active_cap or nudge.cap_id != active_cap:
                continue

        filtered.append(nudge)
    return filtered
