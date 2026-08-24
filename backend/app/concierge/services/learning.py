"""Concierge learning loop — retention, case promotion, periodic model refresh."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.concierge.models import (
    ConciergeEvent,
    ConciergeEventQueue,
    ConciergeRecommendation,
    ConciergeRecommendationOutcome,
    ConciergeTrainingExample,
)
from app.concierge.services.cases import promote_outcome_to_case
from app.concierge.services.training import build_dataset_stats, evaluate_and_register_version

logger = logging.getLogger("concierge.learning")


async def purge_stale_events(session: AsyncSession) -> dict[str, int]:
    """Remove raw events and completed queue rows older than retention window."""
    days = max(7, settings.concierge_event_retention_days)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    events_deleted = (
        await session.execute(delete(ConciergeEvent).where(ConciergeEvent.timestamp < cutoff))
    ).rowcount or 0

    queue_deleted = (
        await session.execute(
            delete(ConciergeEventQueue).where(
                ConciergeEventQueue.status == "completed",
                ConciergeEventQueue.processed_at.isnot(None),
                ConciergeEventQueue.processed_at < cutoff,
            )
        )
    ).rowcount or 0

    if events_deleted or queue_deleted:
        logger.info("Purged %d events, %d queue rows older than %d days", events_deleted, queue_deleted, days)
    return {"events_deleted": events_deleted, "queue_deleted": queue_deleted}


async def promote_successful_outcomes(session: AsyncSession) -> int:
    """Turn resolved recommendation outcomes into historical cases (knowledge base growth)."""
    outcomes = (
        await session.execute(
            select(ConciergeRecommendationOutcome)
            .where(ConciergeRecommendationOutcome.problem_resolved.is_(True))
            .order_by(ConciergeRecommendationOutcome.created_at.desc())
            .limit(50)
        )
    ).scalars().all()

    promoted = 0
    for outcome in outcomes:
        rec = (
            await session.execute(
                select(ConciergeRecommendation).where(ConciergeRecommendation.id == outcome.recommendation_id)
            )
        ).scalar_one_or_none()
        if not rec:
            continue
        if await promote_outcome_to_case(session, rec, outcome):
            promoted += 1
    return promoted


async def run_learning_cycle(session: AsyncSession) -> dict:
    """Issue-focused learning: promote successes, refresh stats, register model version."""
    promoted = await promote_successful_outcomes(session)
    await session.flush()

    issue_examples = (
        await session.execute(
            select(func.count())
            .select_from(ConciergeTrainingExample)
            .where(ConciergeTrainingExample.outcome_label.in_(("SUCCESS", "FAILURE")))
        )
    ).scalar_one()

    stats = await build_dataset_stats(session)
    version_label = f"learn-{datetime.now(timezone.utc):%Y%m%d-%H%M}"
    version = await evaluate_and_register_version(session, version_label)

    result = {
        "issue_labeled_examples": issue_examples,
        "dataset_stats": stats,
        "active_version": version.version,
        "cases_promoted": promoted,
    }
    logger.info("Learning cycle complete: %s", result)
    return result
