from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.concierge.models import ConciergeIncidentEvidence
from app.concierge.schemas.incidents import IncidentDetailOut, IncidentEvidenceOut, IncidentListOut, IncidentOut
from app.concierge.services.incidents import get_incident, list_incidents
from app.database import get_db

router = APIRouter()


@router.get("/incidents", response_model=IncidentListOut)
async def get_incidents(
    status: str | None = Query(None),
    limit: int = Query(50, le=200),
    session: AsyncSession = Depends(get_db),
):
    rows = await list_incidents(session, limit=limit, status=status)
    return IncidentListOut(
        incidents=[_to_out(r) for r in rows],
        total=len(rows),
    )


@router.get("/incidents/{incident_id}", response_model=IncidentDetailOut)
async def get_incident_detail(incident_id: UUID, session: AsyncSession = Depends(get_db)):
    incident = await get_incident(session, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    evidence_rows = (
        await session.execute(
            select(ConciergeIncidentEvidence).where(ConciergeIncidentEvidence.incident_id == incident_id)
        )
    ).scalars().all()

    out = _to_out(incident)
    return IncidentDetailOut(
        **out.model_dump(),
        evidence=[
            IncidentEvidenceOut(
                evidence_type=e.evidence_type,
                summary=e.summary,
                event_id=str(e.event_id) if e.event_id else None,
                metadata=e.metadata_ or {},
            )
            for e in evidence_rows
        ],
    )


def _to_out(incident) -> IncidentOut:
    return IncidentOut(
        id=str(incident.id),
        incident_key=incident.incident_key,
        incident_type=incident.incident_type,
        severity=incident.severity,
        status=incident.status,
        started_at=incident.started_at,
        ended_at=incident.ended_at,
        affected_feature=incident.affected_feature,
        affected_user=incident.affected_user,
        session_id=incident.session_id,
        signals=incident.signals or {},
    )
