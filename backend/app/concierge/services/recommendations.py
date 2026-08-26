"""Evidence-based recommendation engine — ranking follows live outcomes."""

from __future__ import annotations

import uuid
from collections import Counter, defaultdict
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.concierge.models import (
    ConciergeCase,
    ConciergeIncident,
    ConciergeNudge,
    ConciergeRecommendation,
    ConciergeRecommendationOutcome,
    ConciergeTrainingExample,
)
from app.concierge.services.cases import RESOLUTION_PATTERNS, find_similar_cases
from app.concierge.services.incidents import mark_recommendation_available
from app.concierge.services.reliability import ReliabilityInput, calculate_reliability
from app.concierge.services.training import ensure_active_model_version


async def generate_recommendations(
    session: AsyncSession,
    incident: ConciergeIncident,
) -> list[ConciergeRecommendation]:
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
    if existing_primary and not await _outcomes_newer_than(session, incident, existing_primary.created_at):
        return [existing_primary]
    if existing_primary:
        existing_primary.rank = 100

    similar = await find_similar_cases(session, incident)
    if not similar or similar[0][1] < 0.25:
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

    live_stats = await _resolution_outcome_stats(session, incident.incident_type)
    dismiss_counts = await _resolution_dismiss_counts(session, incident.incident_type)
    active_version = await ensure_active_model_version(session)
    snapshot_rate = float((active_version.metrics or {}).get("success_rate") or 0.0)

    ranked: list[tuple[float, str]] = []
    for action, count in resolution_counts.items():
        summary, case_ids, max_sim, case_count, case_successes = resolution_meta[action]
        successes, failures = live_stats.get(action, (case_successes, max(0, case_count - case_successes)))
        if successes + failures == 0:
            successes, failures = case_successes, max(0, case_count - case_successes)
        prior_total = successes + failures
        total = max(prior_total, 1)
        live_rate = successes / total
        dismisses = dismiss_counts.get(action, 0)
        dismiss_penalty = 1.0 / (1.0 + dismisses)
        weight = (live_rate * 0.55) + (max_sim * 0.30) + (min(case_count, 10) / 10.0 * 0.15)
        weight *= dismiss_penalty
        if snapshot_rate > 0:
            weight = (weight * 0.9) + (snapshot_rate * 0.1)
        ranked.append((weight, action))

    ranked.sort(key=lambda x: x[0], reverse=True)

    recs: list[ConciergeRecommendation] = []
    rank = 1
    signals = incident.signals or {}
    evidence_count = int(signals.get("failed_attempts", 0) or len(signals) or 1)

    for _, action in ranked[:3]:
        summary, case_ids, max_sim, case_count, case_successes = resolution_meta[action]
        successes, failures = live_stats.get(action, (case_successes, max(0, case_count - case_successes)))
        if successes + failures == 0:
            successes, failures = case_successes, max(0, case_count - case_successes)
        prior_total = max(successes + failures, 1)
        rel = calculate_reliability(
            ReliabilityInput(
                similar_case_count=prior_total,
                successful_outcomes=successes,
                avg_similarity=max_sim,
                evidence_count=evidence_count,
                evidence_quality="HIGH" if evidence_count >= 3 else "MEDIUM",
            )
        )
        factors = dict(rel.factors)
        factors["prior_outcomes"] = prior_total
        factors["similar_matches"] = case_count
        factors["model_version"] = active_version.version
        factors["live_successes"] = successes
        factors["live_failures"] = failures
        factors["dismiss_count"] = dismiss_counts.get(action, 0)

        rec = ConciergeRecommendation(
            incident_id=incident.id,
            action=action,
            rationale=summary,
            reliability_score=rel.score,
            reliability_factors=factors,
            similar_case_ids=case_ids[:5],
            rank=rank,
            explanation_status="pending",
            model_version_id=active_version.id,
        )
        session.add(rec)
        recs.append(rec)
        rank += 1

    if recs:
        await mark_recommendation_available(session, incident.id)

    return recs


async def _outcomes_newer_than(
    session: AsyncSession,
    incident: ConciergeIncident,
    created_at: datetime | None,
) -> bool:
    if created_at is None:
        return True
    cutoff = created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc)
    latest = (
        await session.execute(
            select(func.max(ConciergeRecommendationOutcome.created_at))
            .select_from(ConciergeRecommendationOutcome)
            .join(
                ConciergeRecommendation,
                ConciergeRecommendation.id == ConciergeRecommendationOutcome.recommendation_id,
            )
            .join(ConciergeIncident, ConciergeIncident.id == ConciergeRecommendation.incident_id)
            .where(ConciergeIncident.incident_type == incident.incident_type)
        )
    ).scalar_one()
    if latest is None:
        return False
    if latest.tzinfo is None:
        latest = latest.replace(tzinfo=timezone.utc)
    return latest > cutoff


async def _resolution_outcome_stats(session: AsyncSession, incident_type: str) -> dict[str, tuple[int, int]]:
    """Live SUCCESS/FAILURE counts per resolution, deduped by incident (case + training example)."""
    stats: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    seen: dict[str, set[uuid.UUID]] = defaultdict(set)

    case_rows = (
        await session.execute(
            select(ConciergeCase.resolution, ConciergeCase.outcome, ConciergeCase.incident_id).where(
                ConciergeCase.incident_type == incident_type
            )
        )
    ).all()
    for resolution, outcome, incident_id in case_rows:
        if incident_id is not None:
            if incident_id in seen[resolution]:
                continue
            seen[resolution].add(incident_id)
        if outcome == "SUCCESS":
            stats[resolution][0] += 1
        elif outcome == "FAILURE":
            stats[resolution][1] += 1

    example_rows = (
        await session.execute(
            select(
                ConciergeTrainingExample.recommendation_text,
                ConciergeTrainingExample.outcome_label,
                ConciergeTrainingExample.incident_id,
            )
            .join(ConciergeIncident, ConciergeIncident.id == ConciergeTrainingExample.incident_id)
            .where(ConciergeIncident.incident_type == incident_type)
        )
    ).all()
    for action, label, incident_id in example_rows:
        if incident_id is not None:
            if incident_id in seen[action]:
                continue
            seen[action].add(incident_id)
        if label == "SUCCESS":
            stats[action][0] += 1
        elif label == "FAILURE":
            stats[action][1] += 1

    return {k: (v[0], v[1]) for k, v in stats.items()}


async def _resolution_dismiss_counts(session: AsyncSession, incident_type: str) -> dict[str, int]:
    rows = (
        await session.execute(
            select(ConciergeRecommendation.action, func.count())
            .join(ConciergeNudge, ConciergeNudge.recommendation_id == ConciergeRecommendation.id)
            .join(ConciergeIncident, ConciergeIncident.id == ConciergeRecommendation.incident_id)
            .where(
                ConciergeIncident.incident_type == incident_type,
                ConciergeNudge.status == "dismissed",
            )
            .group_by(ConciergeRecommendation.action)
        )
    ).all()
    return {action: int(count) for action, count in rows}
