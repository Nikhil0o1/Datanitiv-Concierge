"""Phase 6-7 — historical retrieval, recommendations, reliability."""

import uuid
from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from sqlalchemy import select

from app.concierge.models import ConciergeCase, ConciergeIncident
from app.concierge.services.cases import embed_text, find_similar_cases, seed_default_cases
from app.concierge.services.recommendations import generate_recommendations
from app.concierge.services.reliability import ReliabilityInput, calculate_reliability
from app.concierge.services.training import create_training_example


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
    session.add(
        ConciergeCase(
            case_key=f"CASE-T{uuid.uuid4().hex[:6]}",
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
        incident_key=f"INC-TEST-{uuid.uuid4().hex[:8]}",
        incident_type="SHRINKAGE_DRIFT",
        severity="HIGH",
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
async def test_seed_does_not_insert_starter_pack(db_session):
    session = db_session
    session.add(
        ConciergeCase(
            case_key="CASE-FAKE",
            incident_type="API_FAILURE",
            feature="api",
            summary_text="Demo timeout",
            signals={},
            resolution="Restart pool",
            outcome="SUCCESS",
            embedding=embed_text("API_FAILURE api Demo timeout"),
        )
    )
    await session.flush()
    await seed_default_cases(session)
    await session.commit()
    leftover = (
        await session.execute(select(ConciergeCase).where(ConciergeCase.case_key == "CASE-FAKE"))
    ).scalar_one_or_none()
    assert leftover is None
    seeds = (
        await session.execute(select(ConciergeCase).where(ConciergeCase.incident_id.is_(None)))
    ).scalars().all()
    assert seeds == []


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
    assert len(a) == 384


@pytest.mark.asyncio
async def test_resolution_outcome_stats_dedupes_case_and_training(db_session):
    session = db_session
    from app.concierge.models import ConciergeTrainingExample
    from app.concierge.services.recommendations import _resolution_outcome_stats

    incident = ConciergeIncident(
        incident_key=f"INC-{uuid.uuid4().hex[:6]}",
        incident_type="PLAN_DECISION_REQUIRED",
        severity="HIGH",
        status="DETECTED",
        started_at=datetime.now(timezone.utc),
        affected_feature="planning",
        signals={},
    )
    session.add(incident)
    await session.flush()

    action = f"Demo action dedupe {uuid.uuid4().hex[:8]}"
    session.add(
        ConciergeCase(
            case_key=f"CASE-{uuid.uuid4().hex[:6]}",
            incident_id=incident.id,
            incident_type="PLAN_DECISION_REQUIRED",
            feature="planning",
            summary_text="Staged recommendation selected",
            signals={},
            resolution=action,
            outcome="SUCCESS",
            embedding=embed_text("PLAN_DECISION_REQUIRED planning staged"),
        )
    )
    session.add(
        ConciergeTrainingExample(
            incident_id=incident.id,
            recommendation_text=action,
            outcome_label="SUCCESS",
            input_features={},
        )
    )
    await session.flush()

    stats = await _resolution_outcome_stats(session, "PLAN_DECISION_REQUIRED")
    assert stats.get(action) == (1, 0)


@pytest.mark.asyncio
async def test_failed_outcome_lowers_resolution_rank(db_session):
    session = db_session
    from app.concierge.services.cases import RESOLUTION_PATTERNS

    incident_type = f"RANKTEST_{uuid.uuid4().hex[:8]}"
    loser, winner = RESOLUTION_PATTERNS["SHRINKAGE_DRIFT"][0][0], RESOLUTION_PATTERNS["SHRINKAGE_DRIFT"][1][0]
    extra_patterns = {incident_type: RESOLUTION_PATTERNS["SHRINKAGE_DRIFT"]}

    with patch.dict("app.concierge.services.recommendations.RESOLUTION_PATTERNS", extra_patterns):
        first = ConciergeIncident(
            incident_key=f"INC-{uuid.uuid4().hex[:6]}",
            incident_type=incident_type,
            severity="MEDIUM",
            status="RECOMMENDATION_AVAILABLE",
            started_at=datetime.now(timezone.utc),
            affected_feature="shrinkage",
            signals={"shrink_gap": 12.0, "why": "drift"},
        )
        session.add(first)
        await session.flush()
        recs = await generate_recommendations(session, first)
        loser_rec = next((r for r in recs if r.action == loser), recs[0])
        winner_rec = next((r for r in recs if r.action == winner), recs[-1])
        for _ in range(5):
            await create_training_example(session, loser_rec, "FAILURE")
        for _ in range(3):
            await create_training_example(session, winner_rec, "SUCCESS")
        await session.flush()

        second = ConciergeIncident(
            incident_key=f"INC-{uuid.uuid4().hex[:6]}",
            incident_type=incident_type,
            severity="MEDIUM",
            status="DETECTED",
            started_at=datetime.now(timezone.utc),
            affected_feature="shrinkage",
            signals={"shrink_gap": 14.0, "why": "drift again"},
        )
        session.add(second)
        await session.flush()
        ranked = await generate_recommendations(session, second)
        await session.commit()
        assert ranked
        assert ranked[0].action != loser
        assert ranked[0].model_version_id is not None
        assert "model_version" in (ranked[0].reliability_factors or {})
