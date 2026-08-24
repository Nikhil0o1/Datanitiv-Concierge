from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class IncidentEvidenceOut(BaseModel):
    evidence_type: str
    summary: str
    event_id: str | None = None
    metadata: dict = {}


class IncidentOut(BaseModel):
    id: str
    incident_key: str
    incident_type: str
    severity: str
    status: str
    started_at: datetime
    ended_at: datetime | None = None
    affected_feature: str
    affected_user: str | None = None
    session_id: str | None = None
    signals: dict = {}


class IncidentDetailOut(IncidentOut):
    evidence: list[IncidentEvidenceOut] = []


class IncidentListOut(BaseModel):
    incidents: list[IncidentOut]
    total: int
