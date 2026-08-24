from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.concierge.schemas.events import ConciergeEventBatchIn, ConciergeEventIngestResponse
from app.concierge.services.collector import ingest_events
from app.database import get_db

router = APIRouter()


@router.post("/events", response_model=ConciergeEventIngestResponse)
async def ingest_concierge_events(body: ConciergeEventBatchIn, session: AsyncSession = Depends(get_db)):
    accepted, rejected = await ingest_events(session, body.events)
    return ConciergeEventIngestResponse(
        accepted=len(accepted),
        rejected=rejected,
        event_ids=[str(eid) for eid in accepted],
    )
