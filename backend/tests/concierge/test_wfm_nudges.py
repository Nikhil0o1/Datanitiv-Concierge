"""WFM portfolio monitor and nudge delivery tests."""

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select

from app.concierge.models import ConciergeIncident, ConciergeSession

from app.concierge.services.cases import seed_default_cases
from app.concierge.services.incidents import upsert_wfm_incident
from app.concierge.services.nudges import create_nudge_for_recommendation, list_pending_nudges
from app.concierge.services.portfolio_monitor import run_portfolio_monitor
from app.concierge.services.recommendations import generate_recommendations
from app.concierge.services.wfm_actions import ui_actions_for_wfm_incident


def _cap_id() -> str:
    return f"CAP{uuid.uuid4().hex[:5].upper()}"


def test_ui_actions_for_sustained_under():
    signals = {"cap_id": "CAP00010", "sustained": -4.2}
    actions = ui_actions_for_wfm_incident("PLAN_SUSTAINED_UNDER", signals)
    types = [a["type"] for a in actions]
    assert "open_plan" in types
    assert "open_tab" in types


def test_ui_actions_for_roster_gap():
    signals = {"cap_id": "CAP00012"}
    actions = ui_actions_for_wfm_incident("ROSTER_GAP", signals)
    types = [a["type"] for a in actions]
    assert "map_roster" in types


@pytest.mark.asyncio
async def test_wfm_incident_recommendation_and_nudge(db_session):
    session = db_session
    await seed_default_cases(session)

    cap_id = _cap_id()
    signals = {
        "cap_id": cap_id,
        "plan_name": "ACE Retail Voice",
        "program": "ACE Retail",
        "sustained": -5.5,
        "min_ou_fwd": -3.2,
        "why": "Short 5.50 FTE sustained",
        "bucket": "decision",
    }
    incident, created = await upsert_wfm_incident(session, "PLAN_SUSTAINED_UNDER", signals)
    assert created is True
    assert incident.cap_id == cap_id

    recs = await generate_recommendations(session, incident)
    assert recs
    rec = recs[0]
    rec.domain = "wfm"
    rec.cap_id = cap_id
    rec.ui_actions = ui_actions_for_wfm_incident("PLAN_SUSTAINED_UNDER", signals)

    nudge = await create_nudge_for_recommendation(session, incident, rec)
    await session.commit()

    assert nudge is not None
    assert nudge.status == "pending"
    assert nudge.cap_id == cap_id
    assert nudge.ui_actions

    pending = await list_pending_nudges(session)
    assert any(n.id == nudge.id for n in pending)


@pytest.mark.asyncio
async def test_portfolio_monitor_tracks_incidents(db_session):
    """Portfolio monitor maintains incidents/recs; nudges surface on user context."""
    session = db_session
    await seed_default_cases(session)

    cap_id = _cap_id()
    fake_plan = MagicMock()
    fake_plan.cap_id = cap_id
    fake_plan.hierarchy.cp_plan_name = "Test Plan"
    fake_plan.hierarchy.program_name = "Test Program"
    fake_plan.hierarchy.site_name = "Site A"
    fake_plan.hierarchy.lob_name = "LOB A"
    fake_plan.meta = {
        "sustained": -6.0,
        "minOUfwd": -8.0,
        "shrink12": 22.0,
        "curIdx": 10,
    }
    fake_plan.week_labels = ["8/02", "8/09"]
    fake_plan.shrink_actual = [30.0] * 11
    fake_plan.shrink_plan = [22.0] * 11

    with patch("app.concierge.services.portfolio_monitor.load_all_plans", new=AsyncMock(return_value=[fake_plan])):
        with patch("app.services.plan_helpers.has_roster_gap", return_value=False):
            await run_portfolio_monitor(session)

    incidents = (
        await session.execute(select(ConciergeIncident).where(ConciergeIncident.cap_id == cap_id))
    ).scalars().all()
    assert len(incidents) >= 1


@pytest.mark.asyncio
async def test_nudges_api_flow(client, db_session):
    session = db_session
    await seed_default_cases(session)

    cap_id = _cap_id()
    sid = f"sess-{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc)
    session.add(
        ConciergeSession(
            session_id=sid,
            feature="planning",
            started_at=now,
            last_event_at=now,
            event_count=3,
            error_count=0,
            summary={"active_cap_id": cap_id, "view": "plan"},
        )
    )
    signals = {"cap_id": cap_id, "plan_name": "API Plan", "program": "Prog", "sustained": -3.0, "why": "test"}
    incident, _ = await upsert_wfm_incident(session, "PLAN_DECISION_REQUIRED", signals)
    recs = await generate_recommendations(session, incident)
    rec = recs[0]
    rec.domain = "wfm"
    rec.cap_id = cap_id
    rec.ui_actions = [{"type": "open_plan", "params": {"cap_id": cap_id}}]
    nudge = await create_nudge_for_recommendation(session, incident, rec)
    await session.commit()

    res = await client.get("/api/concierge/nudges/pending", headers={"X-Session-ID": sid})
    assert res.status_code == 200
    body = res.json()
    assert body["total"] >= 1
    nudge_id = body["nudges"][0]["id"]

    res = await client.post(f"/api/concierge/nudges/{nudge_id}/accept")
    assert res.status_code == 200
    assert res.json()["status"] == "accepted"

    res = await client.get("/api/concierge/nudges/pending", headers={"X-Session-ID": sid})
    assert all(n["id"] != nudge_id for n in res.json()["nudges"])
