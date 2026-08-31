"""When Concierge may surface a user-facing nudge — issue-driven, not spam."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.concierge.models import ConciergeEvent, ConciergeIncident, ConciergeNudge, ConciergeSession
from app.concierge.services.sessionization import is_synthetic_session

# Only user navigation should trigger contextual WFM nudges (not passive telemetry).
USER_CONTEXT_EVENTS = frozenset(
    {
        "plan.opened",
        "tab.changed",
        "view.changed",
        "ui.context",
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

# Operational types that may become a card — only after the user just failed a WFM action.
WFM_ACTION_OPERATIONAL_TYPES = frozenset(
    {
        "SHRINKAGE_SUBMISSION_FAILURE",
        "QUEUE_EXECUTE_FAILURE",
        "ROSTER_SUBMISSION_FAILURE",
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

CRITICAL_WFM_TYPES = frozenset({"PLAN_CRITICAL_SHORT"})

TYPE_DISMISS_SUPPRESS_COUNT = 2


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


async def type_nudge_suppressed(session: AsyncSession, incident_type: str, cap_id: str | None) -> bool:
    """True if this incident type was dismissed twice for the same plan."""
    if not cap_id:
        return False
    count = (
        await session.execute(
            select(func.count())
            .select_from(ConciergeNudge)
            .join(ConciergeIncident, ConciergeIncident.id == ConciergeNudge.incident_id)
            .where(
                ConciergeIncident.incident_type == incident_type,
                ConciergeNudge.cap_id == cap_id,
                ConciergeNudge.status == "dismissed",
            )
        )
    ).scalar_one()
    return int(count or 0) >= TYPE_DISMISS_SUPPRESS_COUNT


def reliability_allows_nudge(incident: ConciergeIncident, reliability_score: float) -> bool:
    """Critical WFM may show once below the floor; everything else must clear it."""
    floor = settings.concierge_nudge_min_reliability
    if reliability_score >= floor:
        return True
    return incident.incident_type in CRITICAL_WFM_TYPES


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
    """Operational cards only for a just-failed WFM action in a real user session."""
    if not is_new_incident:
        return False
    if is_synthetic_session(event.session_id):
        return False
    if incident.incident_type not in WFM_ACTION_OPERATIONAL_TYPES:
        return False
    if await incident_nudge_suppressed(session, incident.id):
        return False
    cap_id = incident.cap_id or (incident.signals or {}).get("cap_id")
    if await type_nudge_suppressed(session, incident.incident_type, cap_id):
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
    if await type_nudge_suppressed(session, incident.incident_type, incident.cap_id):
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
    """Friction incidents stay in the DB; they are not user-facing cards."""
    return False


async def wfm_session_budget_exhausted(
    session: AsyncSession,
    user_session_id: str | None,
    *,
    excluding_nudge_id=None,
) -> bool:
    """At most one live WFM card per session, plus a cooldown after one was shown."""
    if not user_session_id or is_synthetic_session(user_session_id):
        return False

    user_sess = (
        await session.execute(select(ConciergeSession).where(ConciergeSession.session_id == user_session_id))
    ).scalar_one_or_none()
    if not user_sess:
        return False

    cooldown = timedelta(minutes=max(1, settings.concierge_nudge_cooldown_minutes))
    last_raw = (user_sess.summary or {}).get("last_wfm_nudge_at")
    if last_raw:
        try:
            last_at = datetime.fromisoformat(str(last_raw).replace("Z", "+00:00"))
            if last_at.tzinfo is None:
                last_at = last_at.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) - last_at < cooldown:
                return True
        except ValueError:
            pass

    active_cap = (user_sess.summary or {}).get("active_cap_id")
    if not active_cap:
        return False

    filters = [
        ConciergeNudge.cap_id == active_cap,
        ConciergeNudge.domain == "wfm",
        ConciergeNudge.status.in_(("pending", "shown")),
    ]
    if excluding_nudge_id is not None:
        filters.append(ConciergeNudge.id != excluding_nudge_id)
    live = (
        await session.execute(select(func.count()).select_from(ConciergeNudge).where(*filters))
    ).scalar_one()
    return int(live or 0) >= settings.concierge_nudge_session_limit


async def mark_session_wfm_nudge(session: AsyncSession, user_session_id: str | None) -> None:
    if not user_session_id or is_synthetic_session(user_session_id):
        return
    user_sess = (
        await session.execute(select(ConciergeSession).where(ConciergeSession.session_id == user_session_id))
    ).scalar_one_or_none()
    if not user_sess:
        return
    summary = dict(user_sess.summary or {})
    summary["last_wfm_nudge_at"] = datetime.now(timezone.utc).isoformat()
    user_sess.summary = summary


async def filter_nudges_for_user_session(
    session: AsyncSession,
    nudges: list[ConciergeNudge],
    user_session_id: str | None,
    *,
    cap_id: str | None = None,
    view: str | None = None,
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
    active_cap = cap_id or ((user_sess.summary or {}).get("active_cap_id") if user_sess else None)
    current_view = view if view is not None else ((user_sess.summary or {}).get("view") if user_sess else None)

    filtered: list[ConciergeNudge] = []
    for nudge in nudges:
        incident = incidents.get(nudge.incident_id)
        if not incident:
            continue

        if incident.incident_type in FRICTION_INCIDENT_TYPES:
            continue

        if incident.incident_type in OPERATIONAL_INCIDENT_TYPES:
            if incident.incident_type not in WFM_ACTION_OPERATIONAL_TYPES:
                continue
            if incident.session_id != user_session_id:
                continue

        if incident.incident_type in WFM_INCIDENT_TYPES or nudge.domain == "wfm":
            if current_view == "port":
                continue
            if not active_cap or nudge.cap_id != active_cap:
                continue

        if await type_nudge_suppressed(session, incident.incident_type, nudge.cap_id):
            continue

        filtered.append(nudge)

    wfm = [n for n in filtered if n.domain == "wfm" or (incidents.get(n.incident_id) and incidents[n.incident_id].incident_type in WFM_INCIDENT_TYPES)]
    other = [n for n in filtered if n not in wfm]
    limit = max(1, settings.concierge_nudge_session_limit)
    return wfm[:limit] + other
