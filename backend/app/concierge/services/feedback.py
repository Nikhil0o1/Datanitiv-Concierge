"""Feedback and outcome tracking — closes the Concierge learning loop."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.concierge.models import ConciergeNudge, ConciergeRecommendation, ConciergeRecommendationOutcome
from app.concierge.schemas.recommendations import FeedbackIn
from app.concierge.services.cases import promote_outcome_to_case
from app.concierge.services.incidents import resolve_incident
from app.concierge.services.training import create_training_example


async def record_feedback(
    session: AsyncSession,
    recommendation_id: UUID,
    feedback: FeedbackIn,
) -> ConciergeRecommendationOutcome:
    rec = (
        await session.execute(select(ConciergeRecommendation).where(ConciergeRecommendation.id == recommendation_id))
    ).scalar_one_or_none()
    if not rec:
        raise ValueError("Recommendation not found")

    outcome = ConciergeRecommendationOutcome(
        recommendation_id=recommendation_id,
        event_type=feedback.event_type,
        action_taken=feedback.action_taken,
        problem_resolved=feedback.problem_resolved,
        notes=feedback.notes,
    )
    session.add(outcome)

    if feedback.event_type == "accepted":
        rec.status = "accepted"
        if feedback.problem_resolved:
            await resolve_incident(session, rec.incident_id, resolved=True)
    elif feedback.event_type == "rejected":
        rec.status = "rejected"
    elif feedback.event_type in ("resolved", "action_taken") and feedback.problem_resolved:
        rec.status = "resolved"
        await resolve_incident(session, rec.incident_id, resolved=True)
    elif feedback.event_type == "escalated":
        rec.status = "escalated"
        await resolve_incident(session, rec.incident_id, resolved=False)

    label = _outcome_label(feedback)
    if label in ("SUCCESS", "FAILURE"):
        await create_training_example(session, rec, label)
        if label == "SUCCESS" and feedback.problem_resolved:
            await promote_outcome_to_case(session, rec, outcome)

    await session.commit()
    return outcome


async def record_nudge_feedback(
    session: AsyncSession,
    nudge_id: UUID,
    event_type: str,
    *,
    action_taken: str | None = None,
    problem_resolved: bool | None = None,
    notes: str | None = None,
) -> None:
    nudge = (await session.execute(select(ConciergeNudge).where(ConciergeNudge.id == nudge_id))).scalar_one_or_none()
    if not nudge:
        return
    await record_feedback(
        session,
        nudge.recommendation_id,
        FeedbackIn(
            event_type=event_type,
            action_taken=action_taken,
            problem_resolved=problem_resolved,
            notes=notes,
        ),
    )


def _outcome_label(feedback: FeedbackIn) -> str:
    if feedback.problem_resolved is True:
        return "SUCCESS"
    if feedback.problem_resolved is False:
        return "FAILURE"
    if feedback.event_type == "accepted":
        return "UNKNOWN"
    if feedback.event_type == "rejected":
        return "FAILURE"
    return "UNKNOWN"
