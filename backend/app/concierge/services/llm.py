"""Concierge LLM explanation layer — evidence-grounded, separate from Vera."""

from __future__ import annotations

import json
import logging

from anthropic import AsyncAnthropic
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.concierge.models import ConciergeIncident, ConciergeRecommendation
from app.concierge.services.metrics import worker_metrics

logger = logging.getLogger("concierge.llm")

EXPLANATION_PROMPT = """You are the Concierge operational intelligence assistant for a WFM planning application.
You explain incidents and recommendations using ONLY the structured evidence provided.
Do NOT invent statistics, success rates, or certainty beyond what the evidence states.
If evidence is insufficient, say so explicitly.

Respond in JSON:
{
  "explanation": "concise explanation of what happened",
  "reasoning": "why this recommendation makes sense given evidence",
  "limitations": "what we don't know or evidence gaps",
  "next_steps": ["step1", "step2"]
}
"""


async def generate_explanation(
    session: AsyncSession,
    incident: ConciergeIncident,
    recommendation: ConciergeRecommendation,
    similar_cases: list[dict],
) -> str | None:
    if not settings.anthropic_api_key or not settings.concierge_llm_enabled:
        recommendation.explanation_status = "skipped"
        recommendation.explanation = _fallback_explanation(incident, recommendation)
        return recommendation.explanation

    evidence_bundle = {
        "incident": {
            "type": incident.incident_type,
            "severity": incident.severity,
            "feature": incident.affected_feature,
            "signals": incident.signals,
        },
        "recommendation": {
            "action": recommendation.action,
            "rationale": recommendation.rationale,
            "reliability_score": recommendation.reliability_score,
            "reliability_factors": recommendation.reliability_factors,
        },
        "historical_cases": similar_cases[:5],
    }

    try:
        worker_metrics.llm_calls += 1
        client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        response = await client.messages.create(
            model=settings.anthropic_model,
            max_tokens=1024,
            temperature=0.3,
            system=EXPLANATION_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": f"Explain this incident and recommendation based on evidence:\n{json.dumps(evidence_bundle, indent=2)}",
                }
            ],
        )
        raw = response.content[0].text if response.content else ""
        parsed = _parse_json(raw)
        explanation = _format_explanation(parsed, recommendation)
        recommendation.explanation = explanation
        recommendation.explanation_status = "completed"
        return explanation
    except Exception:
        worker_metrics.llm_failures += 1
        logger.exception("Concierge LLM explanation failed")
        recommendation.explanation_status = "failed"
        recommendation.explanation = _fallback_explanation(incident, recommendation)
        return recommendation.explanation


def _fallback_explanation(incident: ConciergeIncident, recommendation: ConciergeRecommendation) -> str:
    factors = recommendation.reliability_factors or {}
    if factors.get("message"):
        return str(factors["message"])
    return (
        f"Incident {incident.incident_type} detected on {incident.affected_feature}. "
        f"Recommended action: {recommendation.action}. "
        f"Reliability score: {recommendation.reliability_score:.0%} based on "
        f"{factors.get('similar_cases', 0)} similar cases "
        f"({factors.get('successful_outcomes', 0)} successful)."
    )


def _parse_json(raw: str) -> dict:
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(raw[start : end + 1])
        except json.JSONDecodeError:
            pass
    return {"explanation": raw}


def _format_explanation(parsed: dict, recommendation: ConciergeRecommendation) -> str:
    parts = [
        parsed.get("explanation", ""),
        parsed.get("reasoning", ""),
    ]
    limitations = parsed.get("limitations")
    if limitations:
        parts.append(f"Limitations: {limitations}")
    steps = parsed.get("next_steps")
    if steps:
        parts.append("Next steps: " + "; ".join(steps))
    parts.append(f"Reliability: {recommendation.reliability_score:.0%} (evidence-based, not LLM-estimated).")
    return "\n\n".join(p for p in parts if p)
