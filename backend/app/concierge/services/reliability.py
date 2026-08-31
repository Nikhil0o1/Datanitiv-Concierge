"""Deterministic reliability scoring for recommendations.

Formula (configurable weights in settings):
  reliability = w_similar * avg_similarity
              + w_success * historical_success_rate
              + w_evidence * evidence_strength
              + w_recency * recency_factor

All components are in [0, 1]. Final score clamped to [0, 1].
"""

from __future__ import annotations

from dataclasses import dataclass

from app.config import settings


@dataclass
class ReliabilityInput:
    similar_case_count: int
    successful_outcomes: int
    avg_similarity: float
    evidence_count: int
    evidence_quality: str  # LOW | MEDIUM | HIGH
    days_since_last_similar: float = 0.0


@dataclass
class ReliabilityResult:
    score: float
    factors: dict


def calculate_reliability(inp: ReliabilityInput) -> ReliabilityResult:
    w = settings.reliability_weights

    if inp.similar_case_count == 0:
        return ReliabilityResult(
            score=0.0,
            factors={
                "similar_cases": 0,
                "successful_outcomes": 0,
                "success_rate": 0.0,
                "avg_similarity": 0.0,
                "evidence_strength": "INSUFFICIENT",
                "message": "Insufficient evidence to make a reliable recommendation.",
            },
        )

    success_rate = inp.successful_outcomes / inp.similar_case_count
    evidence_strength = {"LOW": 0.3, "MEDIUM": 0.6, "HIGH": 0.9}.get(inp.evidence_quality.upper(), 0.5)
    evidence_factor = min(1.0, inp.evidence_count / 5.0) * evidence_strength
    recency_factor = max(0.0, 1.0 - inp.days_since_last_similar / 365.0)

    score = (
        w["similarity"] * inp.avg_similarity
        + w["success_rate"] * success_rate
        + w["evidence"] * evidence_factor
        + w["recency"] * recency_factor
    )
    score = round(min(1.0, max(0.0, score)), 4)

    strength_label = "HIGH" if score >= 0.75 else "MEDIUM" if score >= 0.5 else "LOW"

    return ReliabilityResult(
        score=score,
        factors={
            "similar_cases": inp.similar_case_count,
            "prior_outcomes": inp.similar_case_count,
            "successful_outcomes": inp.successful_outcomes,
            "success_rate": round(success_rate, 4),
            "avg_similarity": round(inp.avg_similarity, 4),
            "evidence_count": inp.evidence_count,
            "evidence_strength": strength_label,
            "recency_factor": round(recency_factor, 4),
            "weights": w,
        },
    )
