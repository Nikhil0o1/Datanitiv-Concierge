"""Evidence-based recommendation engine."""

from __future__ import annotations

from collections import Counter
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.concierge.models import ConciergeCase, ConciergeIncident, ConciergeRecommendation
from app.concierge.services.cases import RESOLUTION_PATTERNS, find_similar_cases
from app.concierge.services.incidents import mark_recommendation_available
from app.concierge.services.reliability import ReliabilityInput, calculate_reliability


async def generate_recommendations(session: AsyncSession, incident: ConciergeIncident) -> list[ConciergeRecommendation]:
    existing_primary = (
        await session.execute(
            select(ConciergeRecommendation)
            .where(
                ConciergeRecommendation.incident_id == incident.id,
                ConciergeRecommendation.rank == 1,
            )
            .order_by(ConciergeRecommendation.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if existing_primary:
        return [existing_primary]

    similar = await find_similar_cases(session, incident)
    if not similar:
        patterns = RESOLUTION_PATTERNS.get(incident.incident_type, [])
        similar = [
            (
                ConciergeCase(
                    resolution=p[0],
                    summary_text=p[1],
                    outcome="SUCCESS",
                    incident_type=incident.incident_type,
                    feature=incident.affected_feature,
                    case_key="",
                ),
                p[2],
            )
            for p in patterns[:3]
        ]

    resolution_counts: Counter[str] = Counter()
    resolution_meta: dict[str, tuple[str, list[str], float, int, int]] = {}

    for case, sim_score in similar:
        resolution_counts[case.resolution] += 1
        if case.resolution not in resolution_meta:
            resolution_meta[case.resolution] = (case.summary_text, [], sim_score, 0, 0)
        meta = resolution_meta[case.resolution]
        case_ids = meta[1]
        if hasattr(case, "id") and case.id:
            case_ids.append(str(case.id))
        successes = meta[4] + (1 if case.outcome == "SUCCESS" else 0)
        resolution_meta[case.resolution] = (
            meta[0],
            case_ids,
            max(meta[2], sim_score),
            meta[3] + 1,
            successes,
        )

    recs: list[ConciergeRecommendation] = []
    rank = 1
    signals = incident.signals or {}
    evidence_count = int(signals.get("failed_attempts", 0) or len(signals) or 1)

    for action, count in resolution_counts.most_common(3):
        summary, case_ids, max_sim, case_count, successes = resolution_meta[action]
        rel = calculate_reliability(
            ReliabilityInput(
                similar_case_count=max(case_count, count),
                successful_outcomes=successes,
                avg_similarity=max_sim,
                evidence_count=evidence_count,
                evidence_quality="HIGH" if evidence_count >= 3 else "MEDIUM",
            )
        )

        rec = ConciergeRecommendation(
            incident_id=incident.id,
            action=action,
            rationale=summary,
            reliability_score=rel.score,
            reliability_factors=rel.factors,
            similar_case_ids=case_ids[:5],
            rank=rank,
            explanation_status="pending",
        )
        session.add(rec)
        recs.append(rec)
        rank += 1

    if recs:
        await mark_recommendation_available(session, incident.id)

    return recs
