from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.concierge.models import ConciergeIncident, ConciergeNudge, ConciergeRecommendation
from app.concierge.schemas.nudges import NudgeListOut, NudgeOut, SnoozeIn
from app.concierge.services.context_monitor import ensure_nudge_for_open_plan
from app.concierge.services.feedback import record_nudge_feedback
from app.concierge.services.nudge_policy import WFM_INCIDENT_TYPES
from app.concierge.services.nudges import (
    accept_nudge,
    dismiss_nudge,
    get_nudge,
    list_pending_nudges,
    mark_nudge_shown,
    snooze_nudge,
)
from app.database import get_db

router = APIRouter()


@router.get("/nudges/pending", response_model=NudgeListOut)
async def get_pending_nudges(
    limit: int = Query(10, ge=1, le=50),
    cap_id: str | None = Query(default=None),
    view: str | None = Query(default=None),
    x_session_id: str | None = Header(default=None, alias="X-Session-ID"),
    session: AsyncSession = Depends(get_db),
):
    if view == "plan" and cap_id and x_session_id:
        await ensure_nudge_for_open_plan(session, cap_id=cap_id, session_id=x_session_id)
        await session.commit()
    rows = await list_pending_nudges(
        session,
        limit=limit,
        user_session_id=x_session_id,
        cap_id=cap_id,
        view=view,
    )
    rec_ids = [n.recommendation_id for n in rows]
    recs = {}
    if rec_ids:
        for rec in (
            await session.execute(select(ConciergeRecommendation).where(ConciergeRecommendation.id.in_(rec_ids)))
        ).scalars():
            recs[rec.id] = rec
    return NudgeListOut(
        nudges=[_to_out(n, recs.get(n.recommendation_id)) for n in rows],
        total=len(rows),
    )


@router.get("/nudges/{nudge_id}", response_model=NudgeOut)
async def get_nudge_detail(nudge_id: UUID, session: AsyncSession = Depends(get_db)):
    nudge = await get_nudge(session, nudge_id)
    if not nudge:
        raise HTTPException(status_code=404, detail="Nudge not found")
    return _to_out(nudge)


@router.post("/nudges/{nudge_id}/shown", response_model=NudgeOut)
async def post_nudge_shown(
    nudge_id: UUID,
    session: AsyncSession = Depends(get_db),
    x_session_id: str | None = Header(default=None, alias="X-Session-ID"),
):
    nudge = await mark_nudge_shown(session, nudge_id, user_session_id=x_session_id)
    if not nudge:
        raise HTTPException(status_code=404, detail="Nudge not found")
    return _to_out(nudge)


@router.post("/nudges/{nudge_id}/accept", response_model=NudgeOut)
async def post_nudge_accept(nudge_id: UUID, session: AsyncSession = Depends(get_db)):
    nudge = await get_nudge(session, nudge_id)
    if not nudge:
        raise HTTPException(status_code=404, detail="Nudge not found")
    rec = (
        await session.execute(
            select(ConciergeRecommendation).where(ConciergeRecommendation.id == nudge.recommendation_id)
        )
    ).scalar_one_or_none()
    incident = (
        await session.execute(select(ConciergeIncident).where(ConciergeIncident.id == nudge.incident_id))
    ).scalar_one_or_none()
    action_taken = rec.action if rec else nudge.summary
    wfm_accept = bool(incident and incident.incident_type in WFM_INCIDENT_TYPES)
    await record_nudge_feedback(
        session,
        nudge_id,
        "accepted",
        action_taken=action_taken,
        problem_resolved=True if wfm_accept else None,
    )
    nudge = await accept_nudge(session, nudge_id)
    return _to_out(nudge, rec)


@router.post("/nudges/{nudge_id}/dismiss", response_model=NudgeOut)
async def post_nudge_dismiss(nudge_id: UUID, session: AsyncSession = Depends(get_db)):
    nudge = await get_nudge(session, nudge_id)
    if not nudge:
        raise HTTPException(status_code=404, detail="Nudge not found")
    await record_nudge_feedback(session, nudge_id, "rejected", problem_resolved=False, notes="dismissed")
    nudge = await dismiss_nudge(session, nudge_id)
    return _to_out(nudge)


@router.post("/nudges/{nudge_id}/snooze", response_model=NudgeOut)
async def post_nudge_snooze(nudge_id: UUID, body: SnoozeIn, session: AsyncSession = Depends(get_db)):
    nudge = await get_nudge(session, nudge_id)
    if not nudge:
        raise HTTPException(status_code=404, detail="Nudge not found")
    await record_nudge_feedback(session, nudge_id, "rejected", notes=f"snoozed {body.minutes or 'default'} min")
    nudge = await snooze_nudge(session, nudge_id, minutes=body.minutes)
    return _to_out(nudge)


def _to_out(nudge: ConciergeNudge, rec: ConciergeRecommendation | None = None) -> NudgeOut:
    return NudgeOut(
        id=str(nudge.id),
        recommendation_id=str(nudge.recommendation_id),
        incident_id=str(nudge.incident_id),
        cap_id=nudge.cap_id,
        program=nudge.program,
        domain=nudge.domain,
        title=nudge.title,
        summary=nudge.summary,
        recommendation=rec.action if rec else None,
        explanation=nudge.explanation,
        reliability_score=nudge.reliability_score,
        reliability_factors=nudge.reliability_factors or {},
        ui_actions=nudge.ui_actions or [],
        priority=nudge.priority,
        status=nudge.status,
        snoozed_until=nudge.snoozed_until,
        created_at=nudge.created_at,
    )
