"""Phase 8-10 — LLM mock, feedback, training dataset."""

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from app.concierge.models import ConciergeIncident, ConciergeRecommendation, ConciergeTrainingExample
from app.concierge.schemas.recommendations import FeedbackIn
from app.concierge.services.feedback import record_feedback
from app.concierge.services.llm import generate_explanation
from app.concierge.services.training import build_dataset_stats, create_training_example, evaluate_and_register_version


@pytest.mark.asyncio
async def test_llm_explanation_mocked(db_session):
    session = db_session
    incident = ConciergeIncident(
        incident_key=f"INC-LLM-{uuid.uuid4().hex[:8]}",
        incident_type="API_FAILURE",
        severity="HIGH",
        status="INVESTIGATING",
        started_at=datetime.now(timezone.utc),
        affected_feature="api",
        signals={"failed_attempts": 3},
    )
    session.add(incident)
    await session.flush()

    rec = ConciergeRecommendation(
        incident_id=incident.id,
        action="Check connection pool",
        rationale="Historical success",
        reliability_score=0.9,
        reliability_factors={"similar_cases": 10, "success_rate": 0.9},
    )

    mock_response = AsyncMock()
    mock_response.content = [
        type(
            "Block",
            (),
            {
                "text": '{"explanation":"DB timeout detected","reasoning":"Pool exhausted","limitations":"Small sample","next_steps":["Restart pool"]}'
            },
        )()
    ]

    with patch("app.concierge.services.llm.settings") as mock_settings, patch(
        "app.concierge.services.llm.AsyncAnthropic"
    ) as mock_cls:
        mock_settings.anthropic_api_key = "test-key"
        mock_settings.concierge_llm_enabled = True
        mock_settings.anthropic_model = "claude-sonnet-4-6"
        mock_cls.return_value.messages.create = AsyncMock(return_value=mock_response)

        session.add(rec)
        await session.flush()
        explanation = await generate_explanation(session, incident, rec, [])
        assert explanation
        assert "Reliability" in explanation


@pytest.mark.asyncio
async def test_feedback_creates_training_example(db_session):
    session = db_session
    incident = ConciergeIncident(
        incident_key=f"INC-{uuid.uuid4().hex[:6]}",
        incident_type="QUEUE_EXECUTE_FAILURE",
        severity="MEDIUM",
        status="RECOMMENDATION_AVAILABLE",
        started_at=datetime.now(timezone.utc),
        affected_feature="queue",
        signals={},
    )
    session.add(incident)
    await session.flush()

    rec = ConciergeRecommendation(
        incident_id=incident.id,
        action="Verify package status",
        rationale="Common fix",
        reliability_score=0.8,
        reliability_factors={"similar_cases": 5},
    )
    session.add(rec)
    await session.commit()

    await record_feedback(
        session,
        rec.id,
        FeedbackIn(event_type="resolved", action_taken="Verified status", problem_resolved=True),
    )

    examples = (await session.execute(select(ConciergeTrainingExample))).scalars().all()
    assert any(ex.recommendation_id == rec.id for ex in examples)


@pytest.mark.asyncio
async def test_model_version_evaluation(db_session):
    session = db_session
    rec = ConciergeRecommendation(
        incident_id=uuid.uuid4(),
        action="Test action",
        rationale="Test",
        reliability_score=0.5,
        reliability_factors={},
    )
    await create_training_example(session, rec, "SUCCESS")
    await session.commit()

    stats = await build_dataset_stats(session)
    assert stats["total_examples"] >= 1

    version = await evaluate_and_register_version(session, "1.1.0")
    assert version.version == "1.1.0"


@pytest.mark.asyncio
async def test_training_example_stamps_active_model_version(db_session):
    session = db_session
    from app.concierge.services.training import ensure_active_model_version

    version = await ensure_active_model_version(session)
    incident = ConciergeIncident(
        incident_key=f"INC-{uuid.uuid4().hex[:6]}",
        incident_type="ROSTER_GAP",
        severity="HIGH",
        status="RECOMMENDATION_AVAILABLE",
        started_at=datetime.now(timezone.utc),
        affected_feature="roster",
        signals={},
    )
    session.add(incident)
    await session.flush()
    rec = ConciergeRecommendation(
        incident_id=incident.id,
        action="Map roster classes",
        rationale="Unmapped",
        reliability_score=0.8,
        reliability_factors={},
        model_version_id=version.id,
    )
    session.add(rec)
    await session.flush()
    example = await create_training_example(session, rec, "SUCCESS")
    await session.commit()
    assert example.model_version_id == version.id


@pytest.mark.asyncio
async def test_nudge_created_when_llm_disabled(db_session):
    from sqlalchemy import select

    from app.concierge.models import ConciergeNudge
    from app.concierge.services.cases import seed_default_cases
    from app.concierge.services.incident_pipeline import finalize_incident_with_nudge

    session = db_session
    await seed_default_cases(session)
    cap_id = f"CAP{uuid.uuid4().hex[:5].upper()}"
    incident = ConciergeIncident(
        incident_key=f"INC-{uuid.uuid4().hex[:6]}",
        incident_type="SHRINKAGE_SUBMISSION_FAILURE",
        severity="HIGH",
        status="DETECTED",
        started_at=datetime.now(timezone.utc),
        affected_feature="shrinkage",
        cap_id=cap_id,
        signals={"cap_id": cap_id, "failed_attempts": 3},
    )
    session.add(incident)
    await session.flush()

    rec = await finalize_incident_with_nudge(session, incident, domain="operational", signals=incident.signals)
    await session.commit()
    assert rec is not None
    assert rec.explanation_status == "skipped"
    assert rec.reliability_score is not None
    nudge = (
        await session.execute(select(ConciergeNudge).where(ConciergeNudge.incident_id == incident.id))
    ).scalar_one_or_none()
    assert nudge is not None
    assert "Reliability" in (nudge.explanation or rec.explanation or "")
