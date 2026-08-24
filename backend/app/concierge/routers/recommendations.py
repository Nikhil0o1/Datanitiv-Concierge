from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.concierge.models import ConciergeRecommendation
from app.concierge.schemas.recommendations import (
    FeedbackIn,
    RecommendationDetailOut,
    RecommendationListOut,
    RecommendationOut,
)
from app.concierge.services.feedback import record_feedback
from app.database import get_db

router = APIRouter()


@router.get("/recommendations", response_model=RecommendationListOut)
async def list_recommendations(
    incident_id: UUID | None = Query(None),
    limit: int = Query(50, le=200),
    session: AsyncSession = Depends(get_db),
):
    q = select(ConciergeRecommendation).order_by(ConciergeRecommendation.created_at.desc()).limit(limit)
    if incident_id:
        q = q.where(ConciergeRecommendation.incident_id == incident_id)
    rows = (await session.execute(q)).scalars().all()
    return RecommendationListOut(
        recommendations=[_to_out(r) for r in rows],
        total=len(rows),
    )


@router.get("/recommendations/{recommendation_id}", response_model=RecommendationDetailOut)
async def get_recommendation(recommendation_id: UUID, session: AsyncSession = Depends(get_db)):
    rec = (
        await session.execute(select(ConciergeRecommendation).where(ConciergeRecommendation.id == recommendation_id))
    ).scalar_one_or_none()
    if not rec:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    return RecommendationDetailOut(
        **_to_out(rec).model_dump(),
        similar_case_ids=rec.similar_case_ids or [],
    )


@router.post("/recommendations/{recommendation_id}/feedback")
async def post_feedback(recommendation_id: UUID, body: FeedbackIn, session: AsyncSession = Depends(get_db)):
    try:
        outcome = await record_feedback(session, recommendation_id, body)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {
        "id": outcome.id,
        "recommendation_id": str(recommendation_id),
        "event_type": outcome.event_type,
        "recorded": True,
    }


def _to_out(rec: ConciergeRecommendation) -> RecommendationOut:
    return RecommendationOut(
        id=str(rec.id),
        incident_id=str(rec.incident_id),
        action=rec.action,
        rationale=rec.rationale,
        reliability_score=rec.reliability_score,
        reliability_factors=rec.reliability_factors or {},
        rank=rec.rank,
        explanation=rec.explanation,
        explanation_status=rec.explanation_status,
        status=rec.status,
        cap_id=rec.cap_id,
        program=rec.program,
        domain=rec.domain or "operational",
        ui_actions=rec.ui_actions or [],
        created_at=rec.created_at,
    )
