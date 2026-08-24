"""Phase 6-7 — historical retrieval, recommendations, reliability."""

import uuid
from datetime import datetime, timezone

import pytest

from app.concierge.models import ConciergeIncident
from app.concierge.services.cases import embed_text, find_similar_cases, seed_default_cases
from app.concierge.services.recommendations import generate_recommendations
from app.concierge.services.reliability import ReliabilityInput, calculate_reliability


def test_reliability_deterministic():
    inp = ReliabilityInput(
        similar_case_count=40,
        successful_outcomes=36,
        avg_similarity=0.91,
        evidence_count=4,
        evidence_quality="HIGH",
    )
    r1 = calculate_reliability(inp)
    r2 = calculate_reliability(inp)
    assert r1.score == r2.score
    assert r1.factors["success_rate"] == 0.9


def test_reliability_insufficient_evidence():
    result = calculate_reliability(
        ReliabilityInput(
            similar_case_count=0,
            successful_outcomes=0,
            avg_similarity=0.0,
            evidence_count=0,
            evidence_quality="LOW",
        )
    )
    assert result.score == 0.0
    assert "Insufficient" in result.factors.get("message", "")


@pytest.mark.asyncio
async def test_similar_case_retrieval(db_session):
    session = db_session
    await seed_default_cases(session)
    await session.commit()

    incident = ConciergeIncident(
        incident_key=f"INC-TEST-{uuid.uuid4().hex[:8]}",
        incident_type="API_FAILURE",
        severity="HIGH",
        status="DETECTED",
        started_at=datetime.now(timezone.utc),
        affected_feature="api",
        signals={"failed_attempts": 4, "error_type": "DB_TIMEOUT"},
    )
    session.add(incident)
    await session.flush()

    similar = await find_similar_cases(session, incident)
    assert len(similar) >= 1
    assert similar[0][1] > 0


@pytest.mark.asyncio
async def test_recommendation_generation(db_session):
    session = db_session
    await seed_default_cases(session)
    incident = ConciergeIncident(
        incident_key=f"INC-{uuid.uuid4().hex[:6]}",
        incident_type="SHRINKAGE_SUBMISSION_FAILURE",
        severity="HIGH",
        status="INVESTIGATING",
        started_at=datetime.now(timezone.utc),
        affected_feature="shrinkage",
        signals={"failed_attempts": 3, "error_type": "HTTP_500"},
    )
    session.add(incident)
    await session.flush()

    recs = await generate_recommendations(session, incident)
    await session.commit()
    assert len(recs) >= 1
    assert recs[0].reliability_score >= 0
    assert recs[0].action


def test_embedding_deterministic():
    a = embed_text("timesheet submission failure DB_TIMEOUT")
    b = embed_text("timesheet submission failure DB_TIMEOUT")
    assert a == b
