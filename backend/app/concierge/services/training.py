"""Training dataset builder and model versioning."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.concierge.models import (
    ConciergeIncident,
    ConciergeModelVersion,
    ConciergeRecommendation,
    ConciergeTrainingExample,
)


async def create_training_example(
    session: AsyncSession,
    recommendation: ConciergeRecommendation,
    outcome_label: str,
) -> ConciergeTrainingExample:
    incident = (
        await session.execute(select(ConciergeIncident).where(ConciergeIncident.id == recommendation.incident_id))
    ).scalar_one_or_none()

    example = ConciergeTrainingExample(
        incident_id=recommendation.incident_id,
        recommendation_id=recommendation.id,
        input_features={
            "incident_type": incident.incident_type if incident else None,
            "signals": incident.signals if incident else {},
            "reliability_factors": recommendation.reliability_factors,
        },
        recommendation_text=recommendation.action,
        outcome_label=outcome_label,
    )
    session.add(example)
    return example


async def ensure_active_model_version(session: AsyncSession) -> ConciergeModelVersion:
    active = (
        await session.execute(
            select(ConciergeModelVersion).where(
                ConciergeModelVersion.is_active.is_(True),
                ConciergeModelVersion.model_type == "recommendation",
            )
        )
    ).scalar_one_or_none()
    if active:
        return active

    version = ConciergeModelVersion(
        model_type="recommendation",
        version="1.0.0",
        dataset_version="seed-v1",
        metrics={"precision_at_1": 0.0, "training_examples": 0},
        is_active=True,
        deployed_at=datetime.now(timezone.utc),
    )
    session.add(version)
    await session.flush()
    return version


async def build_dataset_stats(session: AsyncSession) -> dict:
    examples = (await session.execute(select(ConciergeTrainingExample))).scalars().all()
    success = sum(1 for e in examples if e.outcome_label == "SUCCESS")
    failure = sum(1 for e in examples if e.outcome_label == "FAILURE")
    return {
        "total_examples": len(examples),
        "success_count": success,
        "failure_count": failure,
        "success_rate": round(success / len(examples), 4) if examples else 0.0,
    }


async def evaluate_and_register_version(session: AsyncSession, candidate_version: str) -> ConciergeModelVersion:
    stats = await build_dataset_stats(session)
    new_version = ConciergeModelVersion(
        model_type="recommendation",
        version=candidate_version,
        dataset_version=f"dataset-{stats['total_examples']}",
        metrics=stats,
        is_active=False,
    )
    session.add(new_version)
    await session.flush()

    active = (
        await session.execute(
            select(ConciergeModelVersion).where(
                ConciergeModelVersion.is_active.is_(True),
                ConciergeModelVersion.model_type == "recommendation",
            )
        )
    ).scalar_one_or_none()

    if active is None or stats["success_rate"] >= (active.metrics or {}).get("success_rate", 0):
        if active:
            active.is_active = False
        new_version.is_active = True
        new_version.deployed_at = datetime.now(timezone.utc)

    await session.commit()
    return new_version
