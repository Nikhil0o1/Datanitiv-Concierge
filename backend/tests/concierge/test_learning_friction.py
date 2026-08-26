"""Tests for learning loop and friction detection."""

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.concierge.models import ConciergeEvent, ConciergeIncident, ConciergeNudge, ConciergeSession
from app.concierge.services.cases import seed_default_cases
from app.concierge.services.friction_monitor import run_friction_monitor
from app.concierge.services.incident_presentation import incident_title, ui_actions_for_incident
from app.concierge.services.learning import run_learning_cycle


def test_operational_ui_actions():
    actions = ui_actions_for_incident("SHRINKAGE_SUBMISSION_FAILURE", {"cap_id": "CAP00010"})
    assert any(a["type"] == "open_tab" and a["params"]["tab"] == "shr" for a in actions)


@pytest.mark.asyncio
async def test_friction_monitor_creates_nudge(db_session):
    session = db_session
    await seed_default_cases(session)

    sid = f"sess-{uuid.uuid4().hex[:8]}"
    cap_id = f"CAP{uuid.uuid4().hex[:5].upper()}"
    now = datetime.now(timezone.utc)
    session.add(
        ConciergeSession(
            session_id=sid,
            feature="shrinkage",
            started_at=now,
            last_event_at=now,
            event_count=12,
            error_count=4,
            summary={"active_cap_id": cap_id, "active_tab": "shr"},
        )
    )
    session.add(
        ConciergeEvent(
            event_id=uuid.uuid4(),
            timestamp=now,
            session_id=sid,
            event_type="plan.shrinkage.failed",
            source="frontend",
            service="planning-ui",
            severity="error",
            metadata_={"cap_id": cap_id},
        )
    )
    await session.flush()

    count = await run_friction_monitor(session)
    await session.commit()
    assert count >= 1
    incidents = (
        await session.execute(select(ConciergeIncident).where(ConciergeIncident.session_id == sid))
    ).scalars().all()
    incident_ids = {i.id for i in incidents}
    nudges = (await session.execute(select(ConciergeNudge))).scalars().all()
    assert not any(n.incident_id in incident_ids for n in nudges)


@pytest.mark.asyncio
async def test_learning_cycle_runs(db_session):
    session = db_session
    await seed_default_cases(session)
    result = await run_learning_cycle(session)
    assert "dataset_stats" in result
    assert "active_version" in result
