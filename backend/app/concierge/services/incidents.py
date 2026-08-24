"""Incident engine — create, group, lifecycle."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.concierge.models import (
    ConciergeDetectionResult,
    ConciergeIncident,
    ConciergeIncidentEvidence,
)

INCIDENT_TYPE_MAP = {
    "shrinkage_submit_failures": "SHRINKAGE_SUBMISSION_FAILURE",
    "queue_execute_failures": "QUEUE_EXECUTE_FAILURE",
    "agent_chat_failures": "AGENT_CHAT_FAILURE",
    "roster_map_failures": "ROSTER_SUBMISSION_FAILURE",
    "repeated_api_failures": "API_FAILURE",
    "error_rate_spike": "ERROR_RATE_SPIKE",
}

WFM_INCIDENT_FEATURES = {
    "PLAN_SUSTAINED_UNDER": "planning",
    "PLAN_CRITICAL_SHORT": "planning",
    "PLAN_DECISION_REQUIRED": "planning",
    "SHRINKAGE_DRIFT": "shrinkage",
    "ROSTER_GAP": "roster",
    "FORWARD_OU_RISK": "planning",
}


async def create_or_update_incident(
    session: AsyncSession,
    detection: ConciergeDetectionResult,
) -> tuple[ConciergeIncident | None, bool]:
    incident_type = INCIDENT_TYPE_MAP.get(detection.rule_name, detection.rule_name.upper())

    existing = None
    if detection.session_id:
        existing = (
            await session.execute(
                select(ConciergeIncident).where(
                    ConciergeIncident.session_id == detection.session_id,
                    ConciergeIncident.incident_type == incident_type,
                    ConciergeIncident.status.notin_(("RESOLVED", "ESCALATED")),
                )
            )
        ).scalar_one_or_none()

    if existing:
        existing.signals = {**existing.signals, **detection.signal_summary}
        if detection.signal_summary.get("cap_id"):
            existing.cap_id = detection.signal_summary["cap_id"]
        existing.updated_at = datetime.now(timezone.utc)
        detection.incident_id = existing.id
        await _attach_evidence(session, existing.id, detection)
        return existing, False

    count = (await session.execute(select(func.count()).select_from(ConciergeIncident))).scalar_one()
    incident_key = f"INC-{count + 1:04d}"

    severity = "HIGH" if detection.severity == "high" else "MEDIUM"
    incident = ConciergeIncident(
        incident_key=incident_key,
        incident_type=incident_type,
        severity=severity,
        status="DETECTED",
        started_at=datetime.now(timezone.utc),
        affected_feature=detection.feature,
        session_id=detection.session_id,
        cap_id=detection.signal_summary.get("cap_id"),
        signals=detection.signal_summary,
    )
    session.add(incident)
    await session.flush()

    detection.incident_id = incident.id
    await _attach_evidence(session, incident.id, detection)
    incident.status = "INVESTIGATING"
    return incident, True


async def upsert_wfm_incident(
    session: AsyncSession,
    incident_type: str,
    signals: dict,
) -> tuple[ConciergeIncident | None, bool]:
    """Create or refresh a WFM planning incident keyed by cap_id + type."""
    cap_id = signals.get("cap_id")
    if not cap_id:
        return None, False

    existing = (
        await session.execute(
            select(ConciergeIncident).where(
                ConciergeIncident.cap_id == cap_id,
                ConciergeIncident.incident_type == incident_type,
                ConciergeIncident.status.notin_(("RESOLVED", "ESCALATED")),
            )
        )
    ).scalar_one_or_none()

    severity = "HIGH" if incident_type in ("PLAN_CRITICAL_SHORT", "ROSTER_GAP") else "MEDIUM"
    if float(signals.get("sustained", 0)) <= -10:
        severity = "HIGH"

    if existing:
        existing.signals = signals
        existing.severity = severity
        existing.updated_at = datetime.now(timezone.utc)
        return existing, False

    count = (await session.execute(select(func.count()).select_from(ConciergeIncident))).scalar_one()
    feature = WFM_INCIDENT_FEATURES.get(incident_type, "planning")
    incident = ConciergeIncident(
        incident_key=f"INC-{count + 1:04d}",
        incident_type=incident_type,
        severity=severity,
        status="INVESTIGATING",
        started_at=datetime.now(timezone.utc),
        affected_feature=feature,
        cap_id=cap_id,
        session_id=None,
        signals=signals,
    )
    session.add(incident)
    await session.flush()

    session.add(
        ConciergeIncidentEvidence(
            incident_id=incident.id,
            evidence_type="wfm_metric",
            summary=signals.get("why") or f"WFM anomaly on {cap_id}",
            metadata_={"signals": signals},
        )
    )
    return incident, True


async def upsert_session_incident(
    session: AsyncSession,
    incident_type: str,
    signals: dict,
) -> tuple[ConciergeIncident | None, bool]:
    """Create or refresh a session-scoped friction incident."""
    session_id = signals.get("session_id")
    if not session_id:
        return None, False

    existing = (
        await session.execute(
            select(ConciergeIncident).where(
                ConciergeIncident.session_id == session_id,
                ConciergeIncident.incident_type == incident_type,
                ConciergeIncident.status.notin_(("RESOLVED", "ESCALATED")),
            )
        )
    ).scalar_one_or_none()

    if existing:
        existing.signals = signals
        existing.updated_at = datetime.now(timezone.utc)
        return existing, False

    count = (await session.execute(select(func.count()).select_from(ConciergeIncident))).scalar_one()
    incident = ConciergeIncident(
        incident_key=f"INC-{count + 1:04d}",
        incident_type=incident_type,
        severity="MEDIUM",
        status="INVESTIGATING",
        started_at=datetime.now(timezone.utc),
        affected_feature=signals.get("feature") or "session",
        cap_id=signals.get("cap_id"),
        session_id=session_id,
        signals=signals,
    )
    session.add(incident)
    await session.flush()

    session.add(
        ConciergeIncidentEvidence(
            incident_id=incident.id,
            evidence_type="session_friction",
            summary=signals.get("why") or f"Session friction on {session_id}",
            metadata_={"signals": signals},
        )
    )
    return incident, True


async def _attach_evidence(session: AsyncSession, incident_id: UUID, detection: ConciergeDetectionResult) -> None:
    session.add(
        ConciergeIncidentEvidence(
            incident_id=incident_id,
            evidence_type="detection",
            detection_id=detection.id,
            summary=f"Rule {detection.rule_name} triggered: {detection.signal_summary}",
            metadata_={"evidence_event_ids": detection.evidence_event_ids},
        )
    )
    for eid in detection.evidence_event_ids[:10]:
        session.add(
            ConciergeIncidentEvidence(
                incident_id=incident_id,
                evidence_type="event",
                event_id=UUID(eid) if isinstance(eid, str) else eid,
                summary=f"Related event {eid}",
            )
        )


async def get_incident(session: AsyncSession, incident_id: UUID) -> ConciergeIncident | None:
    return (await session.execute(select(ConciergeIncident).where(ConciergeIncident.id == incident_id))).scalar_one_or_none()


async def list_incidents(session: AsyncSession, limit: int = 50, status: str | None = None) -> list[ConciergeIncident]:
    q = select(ConciergeIncident).order_by(ConciergeIncident.created_at.desc()).limit(limit)
    if status:
        q = q.where(ConciergeIncident.status == status)
    return list((await session.execute(q)).scalars().all())


async def mark_recommendation_available(session: AsyncSession, incident_id: UUID) -> None:
    incident = await get_incident(session, incident_id)
    if incident and incident.status == "INVESTIGATING":
        incident.status = "RECOMMENDATION_AVAILABLE"


async def resolve_incident(session: AsyncSession, incident_id: UUID, resolved: bool = True) -> None:
    incident = await get_incident(session, incident_id)
    if incident:
        incident.status = "RESOLVED" if resolved else "ESCALATED"
        incident.ended_at = datetime.now(timezone.utc)
