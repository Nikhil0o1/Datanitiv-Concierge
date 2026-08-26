"""Historical case embeddings and similarity search."""

from __future__ import annotations

import hashlib
import logging
import math
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.concierge.models import ConciergeCase, ConciergeIncident
from app.concierge.services.metrics import worker_metrics

logger = logging.getLogger("concierge.cases")

EMBED_DIM = 384
FASTEMBED_MODEL = "BAAI/bge-small-en-v1.5"

_fastembed_model = None
_fastembed_tried = False

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


def _hash_embed(text: str, dim: int = EMBED_DIM) -> list[float]:
    vec = [0.0] * dim
    tokens = text.lower().split()
    for token in tokens:
        h = int(hashlib.sha256(token.encode()).hexdigest(), 16)
        idx = h % dim
        vec[idx] += 1.0
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def _load_fastembed():
    global _fastembed_model, _fastembed_tried
    if _fastembed_tried:
        return _fastembed_model
    _fastembed_tried = True
    mode = (settings.concierge_embeddings or "auto").lower()
    if mode == "hash":
        return None
    try:
        from fastembed import TextEmbedding

        _fastembed_model = TextEmbedding(model_name=FASTEMBED_MODEL)
        logger.info("Loaded fastembed model %s", FASTEMBED_MODEL)
        return _fastembed_model
    except Exception:
        worker_metrics.embedding_failures += 1
        logger.warning("fastembed unavailable; using hash embeddings", exc_info=True)
        if mode == "fastembed":
            raise
        return None


def embed_text(text: str, dim: int = EMBED_DIM) -> list[float]:
    """Embed a case/incident summary. Prefers fastembed; falls back to a hash vector."""
    model = _load_fastembed()
    if model is not None:
        try:
            vectors = list(model.embed([text]))
            vec = [float(x) for x in vectors[0]]
            if len(vec) != dim:
                if len(vec) > dim:
                    vec = vec[:dim]
                else:
                    vec = vec + [0.0] * (dim - len(vec))
            return vec
        except Exception:
            worker_metrics.embedding_failures += 1
            logger.warning("fastembed failed; using hash embeddings", exc_info=True)
    return _hash_embed(text, dim)


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)


def _as_vector(emb) -> list[float] | None:
    if emb is None:
        return None
    if isinstance(emb, list):
        return [float(x) for x in emb]
    try:
        return [float(x) for x in list(emb)]
    except TypeError:
        return None


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


WFM_SEED_TYPES = frozenset(WFM_RESOLUTION_PATTERNS.keys())


async def purge_non_wfm_seed_cases(session: AsyncSession) -> int:
    """Remove starter-pack rows and any non-WFM history.

    Real learned cases keep an incident_id and a WFM incident_type.
    """
    result = await session.execute(
        delete(ConciergeCase).where(
            (ConciergeCase.incident_id.is_(None))
            | (ConciergeCase.incident_type.notin_(tuple(WFM_SEED_TYPES)))
        )
    )
    n = result.rowcount or 0
    if n:
        logger.info("Purged %d starter-pack / non-WFM cases", n)
    return n


async def _next_case_index(session: AsyncSession) -> int:
    keys = (await session.execute(select(ConciergeCase.case_key))).scalars().all()
    max_n = 0
    for key in keys:
        if not key or not key.startswith("CASE-"):
            continue
        try:
            max_n = max(max_n, int(key.split("-", 1)[1]))
        except ValueError:
            continue
    return max_n + 1


async def seed_default_cases(session: AsyncSession) -> None:
    """No demo library. Recommendations fall back to WFM_RESOLUTION_PATTERNS until real outcomes exist."""
    await purge_non_wfm_seed_cases(session)


async def reembed_cases_if_needed(session: AsyncSession) -> int:
    """Recompute embeddings that are missing or still the old 64-dim hash vectors."""
    cases = (await session.execute(select(ConciergeCase))).scalars().all()
    updated = 0
    for case in cases:
        vec = _as_vector(case.embedding)
        if vec is not None and len(vec) == EMBED_DIM:
            continue
        text_repr = f"{case.incident_type} {case.feature} {case.summary_text}"
        case.embedding = embed_text(text_repr)
        updated += 1
    if updated:
        await session.flush()
        logger.info("Re-embedded %d historical cases", updated)
    await _sync_all_embedding_vec(session)
    return updated


async def find_similar_cases(
    session: AsyncSession,
    incident: ConciergeIncident,
    limit: int = 5,
) -> list[tuple[ConciergeCase, float]]:
    worker_metrics.similar_case_lookups += 1
    query_text = case_representation(incident)
    query_vec = embed_text(query_text)

    pg_hits = await _pgvector_search(session, incident, query_vec, limit)
    if pg_hits:
        return pg_hits

    all_cases = (await session.execute(select(ConciergeCase))).scalars().all()
    scored: list[tuple[ConciergeCase, float]] = []
    for case in all_cases:
        if case.incident_type != incident.incident_type:
            continue
        vec = _as_vector(case.embedding)
        if vec is None:
            continue
        if len(vec) != len(query_vec):
            continue
        score = cosine_similarity(query_vec, vec)
        scored.append((case, score))

    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:limit]


_pgvector_ready: bool | None = None


async def pgvector_available(session: AsyncSession) -> bool:
    global _pgvector_ready
    if _pgvector_ready is not None:
        return _pgvector_ready
    try:
        ext = (await session.execute(text("SELECT 1 FROM pg_extension WHERE extname = 'vector'"))).first()
        if not ext:
            _pgvector_ready = False
            return False
        col = (
            await session.execute(
                text(
                    """
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'concierge_cases' AND column_name = 'embedding_vec'
                    """
                )
            )
        ).first()
        _pgvector_ready = col is not None
    except Exception:
        _pgvector_ready = False
    return _pgvector_ready


async def _sync_all_embedding_vec(session: AsyncSession) -> None:
    if not await pgvector_available(session):
        return
    await session.execute(
        text(
            """
            UPDATE concierge_cases
            SET embedding_vec = CAST(embedding::text AS vector)
            WHERE embedding IS NOT NULL
              AND jsonb_typeof(embedding) = 'array'
              AND jsonb_array_length(embedding) = 384
              AND (embedding_vec IS NULL)
            """
        )
    )


async def _pgvector_search(
    session: AsyncSession,
    incident: ConciergeIncident,
    query_vec: list[float],
    limit: int,
) -> list[tuple[ConciergeCase, float]] | None:
    if not await pgvector_available(session):
        return None
    vec_literal = "[" + ",".join(f"{x:.8f}" for x in query_vec) + "]"
    try:
        async with session.begin_nested():
            result = await session.execute(
                text(
                    """
                    SELECT id, 1 - (embedding_vec <=> CAST(:vec AS vector)) AS similarity
                    FROM concierge_cases
                    WHERE embedding_vec IS NOT NULL
                      AND incident_type = :itype
                    ORDER BY embedding_vec <=> CAST(:vec AS vector)
                    LIMIT :lim
                    """
                ),
                {
                    "vec": vec_literal,
                    "itype": incident.incident_type,
                    "lim": limit,
                },
            )
            rows = result.all()
    except Exception:
        logger.debug("pgvector search failed; using in-process cosine", exc_info=True)
        return None

    if not rows:
        return []

    ids = [row.id for row in rows]
    cases = (
        await session.execute(select(ConciergeCase).where(ConciergeCase.id.in_(ids)))
    ).scalars().all()
    by_id = {c.id: c for c in cases}
    scored: list[tuple[ConciergeCase, float]] = []
    for row in rows:
        case = by_id.get(row.id)
        if case:
            scored.append((case, float(row.similarity or 0.0)))
    return scored


async def promote_outcome_to_case(
    session: AsyncSession,
    recommendation,
    outcome,
) -> bool:
    """Add a successful resolution to the historical case library if not already present."""
    incident = (
        await session.execute(select(ConciergeIncident).where(ConciergeIncident.id == recommendation.incident_id))
    ).scalar_one_or_none()
    if not incident:
        return False
    if incident.incident_type not in WFM_SEED_TYPES:
        return False

    existing = (
        await session.execute(
            select(ConciergeCase).where(
                ConciergeCase.incident_id == incident.id,
                ConciergeCase.resolution == recommendation.action,
            )
        )
    ).scalar_one_or_none()
    if existing:
        if getattr(outcome, "problem_resolved", None) is False:
            existing.outcome = "FAILURE"
        return False

    count = await _next_case_index(session)
    summary = outcome.notes or recommendation.rationale
    text_repr = f"{incident.incident_type} {incident.affected_feature} {summary}"
    resolved = bool(getattr(outcome, "problem_resolved", True))
    session.add(
        ConciergeCase(
            incident_id=incident.id,
            case_key=f"CASE-{count:04d}",
            incident_type=incident.incident_type,
            feature=incident.affected_feature,
            summary_text=summary[:500],
            signals=incident.signals or {},
            resolution=recommendation.action,
            outcome="SUCCESS" if resolved else "FAILURE",
            embedding=embed_text(text_repr),
        )
    )
    await session.flush()
    await _sync_all_embedding_vec(session)
    worker_metrics.cases_promoted += 1
    return True
