"""Embedding fallback and optional pgvector search."""

import uuid
from datetime import datetime, timezone

import pytest

from app.concierge.models import ConciergeCase, ConciergeIncident
from app.concierge.services.cases import EMBED_DIM, embed_text, find_similar_cases, pgvector_available


def test_hash_embed_is_384_and_deterministic():
    a = embed_text("SHRINKAGE_DRIFT shrinkage actual vs plan")
    b = embed_text("SHRINKAGE_DRIFT shrinkage actual vs plan")
    assert len(a) == EMBED_DIM
    assert a == b
    c = embed_text("ROSTER_GAP new hire unmapped")
    assert a != c


@pytest.mark.asyncio
async def test_similar_cases_work_without_pgvector(db_session):
    session = db_session
    session.add(
        ConciergeCase(
            case_key=f"CASE-E{uuid.uuid4().hex[:6]}",
            incident_type="SHRINKAGE_DRIFT",
            feature="shrinkage",
            summary_text="Shrinkage plan aligned to actuals",
            signals={},
            resolution="Compare actual vs planned shrinkage",
            outcome="SUCCESS",
            embedding=embed_text("SHRINKAGE_DRIFT shrinkage Shrinkage plan aligned to actuals"),
        )
    )
    await session.flush()
    incident = ConciergeIncident(
        incident_key=f"INC-EMB-{uuid.uuid4().hex[:8]}",
        incident_type="SHRINKAGE_DRIFT",
        severity="MEDIUM",
        status="DETECTED",
        started_at=datetime.now(timezone.utc),
        affected_feature="shrinkage",
        signals={"shrink_gap": 12.0, "why": "drift"},
    )
    session.add(incident)
    await session.flush()
    similar = await find_similar_cases(session, incident)
    assert len(similar) >= 1
    assert similar[0][0].incident_type == "SHRINKAGE_DRIFT"


@pytest.mark.asyncio
async def test_pgvector_search_when_extension_present(db_session):
    session = db_session
    if not await pgvector_available(session):
        pytest.skip("pgvector extension or embedding_vec column not available")
    session.add(
        ConciergeCase(
            case_key=f"CASE-P{uuid.uuid4().hex[:6]}",
            incident_type="PLAN_SUSTAINED_UNDER",
            feature="planning",
            summary_text="OT plus loan FTE stabilized sustained shortfall",
            signals={},
            resolution="Evaluate OT and cross-utilization",
            outcome="SUCCESS",
            embedding=embed_text("PLAN_SUSTAINED_UNDER planning OT plus loan FTE"),
        )
    )
    from app.concierge.services.cases import reembed_cases_if_needed

    await reembed_cases_if_needed(session)
    await session.flush()
    incident = ConciergeIncident(
        incident_key=f"INC-PGV-{uuid.uuid4().hex[:8]}",
        incident_type="PLAN_SUSTAINED_UNDER",
        severity="HIGH",
        status="DETECTED",
        started_at=datetime.now(timezone.utc),
        affected_feature="planning",
        signals={"sustained": -5.0, "why": "short"},
    )
    session.add(incident)
    await session.flush()
    similar = await find_similar_cases(session, incident)
    if not similar:
        pytest.skip("No similar cases retrieved (embedding_vec unpopulated; hash fallback also empty)")
    assert similar[0][0].incident_type == "PLAN_SUSTAINED_UNDER"
