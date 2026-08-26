"""WFM portfolio monitor and nudge delivery tests."""

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select

from app.concierge.models import ConciergeIncident, ConciergeSession

from app.concierge.services.cases import seed_default_cases
from app.concierge.services.incidents import upsert_wfm_incident
from app.concierge.services.nudges import (
    create_nudge_for_recommendation,
    dismiss_non_wfm_open_nudges,
    dismiss_nudge,
    list_pending_nudges,
)
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
    await session.commit()
    pending = await list_pending_nudges(session, user_session_id=sid)
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

    from app.concierge.models import ConciergeCase
    from app.database import AsyncSessionLocal

    async with AsyncSessionLocal() as check:
        cases = (
            await check.execute(select(ConciergeCase).where(ConciergeCase.incident_id == incident.id))
        ).scalars().all()
    assert len(cases) == 1
    assert cases[0].outcome == "SUCCESS"
    assert cases[0].incident_id == incident.id

    res = await client.get("/api/concierge/nudges/pending", headers={"X-Session-ID": sid})
    assert all(n["id"] != nudge_id for n in res.json()["nudges"])


@pytest.mark.asyncio
async def test_pending_nudges_not_starved_by_higher_priority_noise(db_session):
    """User-plan WFM nudges must surface even when many other pending cards rank higher."""
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

    for _ in range(20):
        other_cap = _cap_id()
        signals = {
            "cap_id": other_cap,
            "plan_name": "Noise Plan",
            "program": "Noise",
            "sustained": -9.0,
            "why": "noise",
        }
        incident, _ = await upsert_wfm_incident(session, "PLAN_CRITICAL_SHORT", signals)
        recs = await generate_recommendations(session, incident)
        rec = recs[0]
        rec.domain = "wfm"
        rec.cap_id = other_cap
        rec.ui_actions = [{"type": "open_plan", "params": {"cap_id": other_cap}}]
        noise = await create_nudge_for_recommendation(session, incident, rec)
        if noise:
            noise.priority = 90

    signals = {"cap_id": cap_id, "plan_name": "CP FTE Based", "program": "ACE Retail", "sustained": -2.0, "why": "fwd"}
    incident, _ = await upsert_wfm_incident(session, "FORWARD_OU_RISK", signals)
    recs = await generate_recommendations(session, incident)
    rec = recs[0]
    rec.domain = "wfm"
    rec.cap_id = cap_id
    rec.ui_actions = [{"type": "open_plan", "params": {"cap_id": cap_id}}]
    target = await create_nudge_for_recommendation(session, incident, rec)
    assert target is not None
    target.priority = 50
    await session.commit()

    pending = await list_pending_nudges(session, limit=5, user_session_id=sid)
    assert any(n.id == target.id for n in pending), [n.cap_id for n in pending]
    assert all(n.cap_id == cap_id for n in pending)


@pytest.mark.asyncio
async def test_reliability_floor_blocks_non_critical(db_session):
    session = db_session
    await seed_default_cases(session)
    cap_id = _cap_id()
    signals = {"cap_id": cap_id, "plan_name": "Low Rel", "program": "P", "sustained": -2.0, "why": "gap"}
    incident, _ = await upsert_wfm_incident(session, "PLAN_SUSTAINED_UNDER", signals)
    recs = await generate_recommendations(session, incident)
    rec = recs[0]
    rec.domain = "wfm"
    rec.cap_id = cap_id
    rec.reliability_score = 0.2
    nudge = await create_nudge_for_recommendation(session, incident, rec)
    assert nudge is None


@pytest.mark.asyncio
async def test_critical_wfm_may_nudge_below_floor(db_session):
    session = db_session
    await seed_default_cases(session)
    cap_id = _cap_id()
    signals = {"cap_id": cap_id, "plan_name": "Critical", "program": "P", "sustained": -9.0, "why": "crit"}
    incident, _ = await upsert_wfm_incident(session, "PLAN_CRITICAL_SHORT", signals)
    recs = await generate_recommendations(session, incident)
    rec = recs[0]
    rec.domain = "wfm"
    rec.cap_id = cap_id
    rec.reliability_score = 0.2
    nudge = await create_nudge_for_recommendation(session, incident, rec)
    assert nudge is not None


@pytest.mark.asyncio
async def test_type_dismissed_twice_stays_quiet(db_session):
    session = db_session
    await seed_default_cases(session)
    cap_id = _cap_id()

    async def _make_nudge():
        incident = ConciergeIncident(
            incident_key=f"INC-{uuid.uuid4().hex[:8]}",
            incident_type="SHRINKAGE_DRIFT",
            severity="MEDIUM",
            status="DETECTED",
            started_at=datetime.now(timezone.utc),
            affected_feature="shrinkage",
            cap_id=cap_id,
            signals={"cap_id": cap_id, "plan_name": "Drift", "program": "P", "shrink_gap": 12.0, "why": "drift"},
        )
        session.add(incident)
        await session.flush()
        recs = await generate_recommendations(session, incident)
        rec = recs[0]
        rec.domain = "wfm"
        rec.cap_id = cap_id
        rec.reliability_score = max(rec.reliability_score, 0.8)
        return incident, await create_nudge_for_recommendation(session, incident, rec)

    _, first = await _make_nudge()
    assert first is not None, "first nudge should be created"
    await dismiss_nudge(session, first.id)

    incident2, second = await _make_nudge()
    assert second is not None, (
        f"second nudge blocked recs={incident2.id} "
        f"after one dismiss of type+cap"
    )
    await dismiss_nudge(session, second.id)

    _, third = await _make_nudge()
    assert third is None


@pytest.mark.asyncio
async def test_session_budget_returns_at_most_one_wfm_nudge(db_session):
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
    signals = {"cap_id": cap_id, "plan_name": "One", "program": "P", "sustained": -3.0, "why": "under"}
    incident, _ = await upsert_wfm_incident(session, "PLAN_SUSTAINED_UNDER", signals)
    recs = await generate_recommendations(session, incident)
    rec = recs[0]
    rec.domain = "wfm"
    rec.cap_id = cap_id
    await create_nudge_for_recommendation(session, incident, rec)
    await session.commit()

    pending = await list_pending_nudges(session, limit=10, user_session_id=sid)
    assert len(pending) <= 1


@pytest.mark.asyncio
async def test_portfolio_view_does_not_nudge(db_session):
    from app.concierge.models import ConciergeEvent
    from app.concierge.services.nudge_policy import should_nudge_for_user_context

    session = db_session
    cap_id = _cap_id()
    sid = f"sess-{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc)
    event = ConciergeEvent(
        event_id=uuid.uuid4(),
        timestamp=now,
        session_id=sid,
        event_type="view.changed",
        source="frontend",
        service="planning-ui",
        severity="info",
        metadata_={"to_view": "port", "cap_id": cap_id, "view": "port"},
    )
    incident, _ = await upsert_wfm_incident(
        session,
        "SHRINKAGE_DRIFT",
        {"cap_id": cap_id, "plan_name": "X", "program": "P", "shrink_gap": 12.0, "why": "drift"},
    )
    session.add(event)
    await session.flush()
    assert await should_nudge_for_user_context(session, event=event, incident=incident) is False


@pytest.mark.asyncio
async def test_context_nudge_skips_already_accepted_incident(db_session):
    from app.concierge.models import ConciergeEvent
    from app.concierge.services.context_monitor import maybe_nudge_for_user_context

    session = db_session
    cap_id = _cap_id()
    sid = f"sess-{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc)
    session.add(
        ConciergeSession(
            session_id=sid,
            feature="planning",
            started_at=now,
            last_event_at=now,
            event_count=2,
            error_count=0,
            summary={"active_cap_id": cap_id, "view": "plan"},
        )
    )
    accepted, _ = await upsert_wfm_incident(
        session,
        "PLAN_CRITICAL_SHORT",
        {"cap_id": cap_id, "plan_name": "X", "program": "P", "sustained": -12.0, "why": "crit"},
    )
    open_inc, _ = await upsert_wfm_incident(
        session,
        "SHRINKAGE_DRIFT",
        {"cap_id": cap_id, "plan_name": "X", "program": "P", "shrink_gap": 14.0, "why": "drift"},
    )
    recs = await generate_recommendations(session, accepted)
    rec = recs[0]
    rec.domain = "wfm"
    rec.cap_id = cap_id
    rec.reliability_score = max(rec.reliability_score or 0, 0.8)
    first = await create_nudge_for_recommendation(session, accepted, rec)
    assert first is not None
    first.status = "accepted"
    first.accepted_at = now
    await session.flush()

    event = ConciergeEvent(
        event_id=uuid.uuid4(),
        timestamp=now,
        session_id=sid,
        event_type="plan.opened",
        source="frontend",
        service="planning-ui",
        severity="info",
        metadata_={"cap_id": cap_id, "view": "plan", "source": "user"},
    )
    session.add(event)
    await session.flush()

    assert await maybe_nudge_for_user_context(session, event) is True
    pending = await list_pending_nudges(session, limit=5, user_session_id=sid)
    assert any(n.incident_id == open_inc.id for n in pending)


@pytest.mark.asyncio
async def test_pending_uses_request_cap_not_stale_session(db_session):
    session = db_session
    live_cap = _cap_id()
    stale_cap = _cap_id()
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
            summary={"active_cap_id": stale_cap, "view": "plan"},
        )
    )
    incident, _ = await upsert_wfm_incident(
        session,
        "PLAN_DECISION_REQUIRED",
        {"cap_id": live_cap, "plan_name": "Live", "program": "P", "sustained": -4.0, "why": "dec"},
    )
    recs = await generate_recommendations(session, incident)
    rec = recs[0]
    rec.domain = "wfm"
    rec.cap_id = live_cap
    rec.reliability_score = max(rec.reliability_score or 0, 0.8)
    target = await create_nudge_for_recommendation(session, incident, rec)
    assert target is not None
    await session.commit()

    stale = await list_pending_nudges(session, limit=5, user_session_id=sid)
    assert all(n.cap_id != live_cap for n in stale)

    pending = await list_pending_nudges(session, limit=5, user_session_id=sid, cap_id=live_cap, view="plan")
    assert any(n.id == target.id for n in pending)


@pytest.mark.asyncio
async def test_dismiss_non_wfm_open_nudges(db_session):
    from app.concierge.models import ConciergeNudge, ConciergeRecommendation

    session = db_session
    cap_id = _cap_id()
    now = datetime.now(timezone.utc)
    op_incident = ConciergeIncident(
        incident_key=f"INC-{uuid.uuid4().hex[:8]}",
        incident_type="API_FAILURE",
        severity="HIGH",
        status="DETECTED",
        started_at=now,
        affected_feature="api",
        cap_id=cap_id,
        signals={"cap_id": cap_id},
    )
    wfm_incident = ConciergeIncident(
        incident_key=f"INC-{uuid.uuid4().hex[:8]}",
        incident_type="SHRINKAGE_DRIFT",
        severity="MEDIUM",
        status="DETECTED",
        started_at=now,
        affected_feature="shrinkage",
        cap_id=cap_id,
        signals={"cap_id": cap_id},
    )
    session.add_all([op_incident, wfm_incident])
    await session.flush()
    op_rec = ConciergeRecommendation(
        incident_id=op_incident.id,
        cap_id=cap_id,
        domain="operational",
        action="Restart pool",
        rationale="Demo",
        reliability_score=0.9,
        reliability_factors={},
        rank=1,
    )
    wfm_rec = ConciergeRecommendation(
        incident_id=wfm_incident.id,
        cap_id=cap_id,
        domain="wfm",
        action="Revise shrinkage",
        rationale="Drift",
        reliability_score=0.8,
        reliability_factors={},
        rank=1,
    )
    session.add_all([op_rec, wfm_rec])
    await session.flush()
    session.add_all(
        [
            ConciergeNudge(
                recommendation_id=op_rec.id,
                incident_id=op_incident.id,
                cap_id=cap_id,
                domain="operational",
                title="API failure",
                summary="Demo card",
                reliability_score=0.9,
                status="pending",
            ),
            ConciergeNudge(
                recommendation_id=wfm_rec.id,
                incident_id=wfm_incident.id,
                cap_id=cap_id,
                domain="wfm",
                title="Shrinkage drift",
                summary="WFM card",
                reliability_score=0.8,
                status="pending",
            ),
        ]
    )
    await session.flush()

    n = await dismiss_non_wfm_open_nudges(session)
    await session.commit()
    assert n >= 1
    leftover = (
        await session.execute(
            select(ConciergeNudge).where(
                ConciergeNudge.status.in_(("pending", "shown")),
                ConciergeNudge.cap_id == cap_id,
            )
        )
    ).scalars().all()
    assert len(leftover) == 1
    assert leftover[0].incident_id == wfm_incident.id
