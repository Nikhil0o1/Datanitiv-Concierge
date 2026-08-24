"""Historical case embeddings and similarity search."""

from __future__ import annotations

import hashlib
import math
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.concierge.models import ConciergeCase, ConciergeIncident
from app.concierge.services.incidents import WFM_INCIDENT_FEATURES

EMBED_DIM = 64

WFM_RESOLUTION_PATTERNS = {
    "PLAN_SUSTAINED_UNDER": [
        ("Review shrinkage assumptions and adjust forward weeks to recover sustained FTE gap", "Shrinkage correction closed sustained understaffing gap", 0.82),
        ("Evaluate OT and cross-utilization options before changing shrinkage plan", "OT plus loan FTE stabilized sustained shortfall", 0.78),
        ("Open recommendation tab and apply staged OT / new hire package", "Approved plan package posted to recover FTE", 0.85),
    ],
    "PLAN_CRITICAL_SHORT": [
        ("Escalate to decision queue — critical sustained FTE shortfall requires immediate plan action", "Decision package approved and executed same cycle", 0.88),
        ("Review worst forward OU week and prioritize OT or cross-util", "Forward OU risk mitigated via OT allocation", 0.80),
    ],
    "PLAN_DECISION_REQUIRED": [
        ("Review decision bucket plan and confirm shrinkage vs hiring tradeoff", "Planner confirmed shrinkage adjustment path", 0.76),
        ("Open recommendation tab to compare OT, loan FTE, and new hire options", "Staged recommendation selected and queued", 0.83),
    ],
    "SHRINKAGE_DRIFT": [
        ("Compare actual vs planned shrinkage over trailing 12 weeks and revise plan", "Shrinkage plan aligned to actuals — autopilot gap closed", 0.86),
        ("Submit updated shrinkage values for forward weeks in shrinkage editor", "Shrinkage submission corrected drift vs plan", 0.84),
    ],
    "ROSTER_GAP": [
        ("Map roster classes to projected FTE — unmapped classes block accurate planning", "Roster mapping corrected projected FTE", 0.90),
        ("Review new hire tab for unmapped roster classes before submitting plan", "Roster gap cleared after class mapping", 0.87),
    ],
    "FORWARD_OU_RISK": [
        ("Review forward OU chart — worst week exceeds tolerance threshold", "Forward OU stabilized after shrinkage adjustment", 0.79),
        ("Evaluate cross-utilization from donor plans with surplus FTE", "Loan FTE covered forward OU shortfall", 0.81),
    ],
}

RESOLUTION_PATTERNS = {
    "SHRINKAGE_SUBMISSION_FAILURE": [
        ("Refresh browser session and retry shrinkage submission", "Session refresh resolved stale UI state", 0.85),
        ("Check database connection pool and restart backend if timeouts persist", "DB pool recovery resolved timeout", 0.90),
        ("Verify plan week indices match current cycle before resubmitting", "Invalid week index caused repeated failures", 0.75),
    ],
    "QUEUE_EXECUTE_FAILURE": [
        ("Verify selected packages are in pending status before execute", "Package state mismatch caused failure", 0.80),
        ("Check database connection pool under load", "Connection pool exhaustion resolved execute failures", 0.88),
    ],
    "AGENT_CHAT_FAILURE": [
        ("Verify Anthropic API key and model availability", "API key or model misconfiguration", 0.92),
        ("Restart backend to pick up configuration changes", "Stale process held old config", 0.70),
    ],
    "API_FAILURE": [
        ("Investigate database connection pool and query timeouts", "Connection pool recovery resolved API 500s", 0.90),
        ("Check PostgreSQL availability and connection limits", "Database restart resolved timeouts", 0.85),
    ],
    "ERROR_RATE_SPIKE": [
        ("Investigate database connection pool under elevated load", "Pool sizing adjustment reduced error rate", 0.88),
        ("Review recent deployments for regression", "Rollback resolved spike", 0.75),
    ],
    "USER_FRICTION": [
        ("Walk through the failing step — check errors in the current tab and retry once", "Guided retry cleared session friction", 0.78),
        ("Open the recommendation tab for staged fixes on this plan", "Staged recommendation resolved the struggle", 0.82),
    ],
    "SESSION_ABANDONED": [
        ("Return to the plan and review shrinkage or roster tab where errors occurred", "User completed workflow after guided return", 0.75),
    ],
    "ROSTER_SUBMISSION_FAILURE": [
        ("Review new hire tab for unmapped roster classes before remapping", "Roster remapped after repeated failures", 0.86),
    ],
    **WFM_RESOLUTION_PATTERNS,
}


def embed_text(text: str, dim: int = EMBED_DIM) -> list[float]:
    """Deterministic feature embedding from text — swap for real model in production."""
    vec = [0.0] * dim
    tokens = text.lower().split()
    for token in tokens:
        h = int(hashlib.sha256(token.encode()).hexdigest(), 16)
        idx = h % dim
        vec[idx] += 1.0
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(x * x for x in b)) or 1.0
    return dot / (na * nb)


def case_representation(incident: ConciergeIncident) -> str:
    signals = incident.signals or {}
    if incident.incident_type in WFM_RESOLUTION_PATTERNS:
        parts = [
            incident.incident_type,
            incident.affected_feature,
            str(signals.get("cap_id", "")),
            str(signals.get("sustained", "")),
            str(signals.get("shrink_gap", "")),
            str(signals.get("min_ou_fwd", "")),
            str(signals.get("why", "")),
        ]
    else:
        parts = [
            incident.incident_type,
            incident.affected_feature,
            str(signals.get("failed_attempts", "")),
            str(signals.get("error_type", "")),
            str(signals.get("current_error_rate", "")),
        ]
    return " ".join(p for p in parts if p)


async def seed_default_cases(session: AsyncSession) -> None:
    count = (await session.execute(select(ConciergeCase).limit(1))).scalar_one_or_none()
    if count:
        return

    idx = 1
    for incident_type, patterns in {**RESOLUTION_PATTERNS}.items():
        if incident_type in WFM_RESOLUTION_PATTERNS:
            feature = WFM_INCIDENT_FEATURES.get(incident_type, "planning")
        else:
            feature = incident_type.split("_")[0].lower()
            if feature == "error":
                feature = "api"
        for resolution, summary, _ in patterns:
            text = f"{incident_type} {feature} {summary}"
            session.add(
                ConciergeCase(
                    case_key=f"CASE-{idx:04d}",
                    incident_type=incident_type,
                    feature=feature if feature != "error" else "api",
                    summary_text=summary,
                    signals={"incident_type": incident_type},
                    resolution=resolution,
                    outcome="SUCCESS",
                    embedding=embed_text(text),
                )
            )
            idx += 1


async def find_similar_cases(
    session: AsyncSession,
    incident: ConciergeIncident,
    limit: int = 5,
) -> list[tuple[ConciergeCase, float]]:
    query_text = case_representation(incident)
    query_vec = embed_text(query_text)

    all_cases = (await session.execute(select(ConciergeCase))).scalars().all()
    scored: list[tuple[ConciergeCase, float]] = []
    for case in all_cases:
        if case.incident_type != incident.incident_type and case.feature != incident.affected_feature:
            continue
        emb = case.embedding
        if emb is None:
            continue
        if isinstance(emb, list):
            vec = emb
        else:
            vec = list(emb)
        score = cosine_similarity(query_vec, vec)
        scored.append((case, score))

    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:limit]


async def promote_outcome_to_case(
    session: AsyncSession,
    recommendation,
    outcome,
) -> bool:
    """Add a successful resolution to the historical case library if not already present."""
    from app.concierge.models import ConciergeCase, ConciergeIncident

    incident = (
        await session.execute(select(ConciergeIncident).where(ConciergeIncident.id == recommendation.incident_id))
    ).scalar_one_or_none()
    if not incident:
        return False

    existing = (
        await session.execute(
            select(ConciergeCase).where(
                ConciergeCase.incident_type == incident.incident_type,
                ConciergeCase.resolution == recommendation.action,
            )
        )
    ).scalar_one_or_none()
    if existing:
        return False

    count = (await session.execute(select(func.count()).select_from(ConciergeCase))).scalar_one()
    summary = outcome.notes or recommendation.rationale
    text = f"{incident.incident_type} {incident.affected_feature} {summary}"
    session.add(
        ConciergeCase(
            incident_id=incident.id,
            case_key=f"CASE-{count + 1:04d}",
            incident_type=incident.incident_type,
            feature=incident.affected_feature,
            summary_text=summary[:500],
            signals=incident.signals or {},
            resolution=recommendation.action,
            outcome="SUCCESS",
            embedding=embed_text(text),
        )
    )
    return True
