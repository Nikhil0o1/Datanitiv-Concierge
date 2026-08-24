"""Phase 4-5 — detection and incident tests."""

import uuid

import pytest
from sqlalchemy import select

from app.concierge.models import ConciergeEvent, ConciergeIncident
from app.concierge.schemas.events import ConciergeEventIn
from app.concierge.services.collector import ingest_events
from app.concierge.services.detection import ensure_default_rules, run_detection
from app.concierge.services.incidents import create_or_update_incident


@pytest.mark.asyncio
async def test_threshold_detection_triggers(db_session):
    session_id = f"detect-test-{uuid.uuid4().hex[:8]}"
    session = db_session
    await ensure_default_rules(session)
    await session.commit()

    for i in range(3):
        await ingest_events(
            session,
            [
                ConciergeEventIn(
                    event_type="plan.shrinkage.failed",
                    source="frontend",
                    severity="error",
                    session_id=session_id,
                    metadata={"attempt": i + 1},
                )
            ],
        )

    event = (
        await session.execute(select(ConciergeEvent).where(ConciergeEvent.session_id == session_id).limit(1))
    ).scalar_one()

    detections = await run_detection(session, event)
    assert len(detections) >= 1
    shrink_detections = [d for d in detections if d.rule_name == "shrinkage_submit_failures"]
    assert shrink_detections

    incident, created = await create_or_update_incident(session, shrink_detections[0])
    assert incident is not None
    assert created is True
    assert incident.incident_type == "SHRINKAGE_SUBMISSION_FAILURE"
    await session.commit()


@pytest.mark.asyncio
async def test_incident_deduplication(db_session):
    session_id = f"dedup-test-{uuid.uuid4().hex[:8]}"
    session = db_session
    await ensure_default_rules(session)

    for _ in range(4):
        await ingest_events(
            session,
            [
                ConciergeEventIn(
                    event_type="api_error",
                    source="backend",
                    severity="error",
                    session_id=session_id,
                    status_code=500,
                    error_code="DB_TIMEOUT",
                    endpoint="/api/plans/CAP00001/shrinkage",
                )
            ],
        )

    events = (await session.execute(select(ConciergeEvent).where(ConciergeEvent.session_id == session_id))).scalars().all()
    last_event = events[-1]
    detections = await run_detection(session, last_event)

    for det in detections:
        await create_or_update_incident(session, det)
    await session.commit()

    keys = (
        await session.execute(
            select(ConciergeIncident.incident_key).where(ConciergeIncident.session_id == session_id)
        )
    ).scalars().all()
    assert len(set(keys)) >= 1
