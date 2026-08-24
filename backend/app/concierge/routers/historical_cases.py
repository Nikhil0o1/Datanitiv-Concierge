from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.concierge.schemas.recommendations import HistoricalCaseOut
from app.concierge.services.cases import find_similar_cases
from app.concierge.services.incidents import get_incident
from app.database import get_db

router = APIRouter()


@router.get("/historical-cases", response_model=list[HistoricalCaseOut])
async def get_historical_cases(
    incident_id: UUID = Query(...),
    limit: int = Query(5, le=20),
    session: AsyncSession = Depends(get_db),
):
    incident = await get_incident(session, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    similar = await find_similar_cases(session, incident, limit=limit)
    return [
        HistoricalCaseOut(
            id=str(case.id),
            case_key=case.case_key,
            incident_type=case.incident_type,
            feature=case.feature,
            summary_text=case.summary_text,
            resolution=case.resolution,
            outcome=case.outcome,
            similarity_score=round(score, 4),
        )
        for case, score in similar
    ]
