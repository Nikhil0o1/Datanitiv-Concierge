"""WFM portfolio monitor — detects planning anomalies from live Cape data."""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.concierge.models import ConciergeRecommendation
from app.concierge.services.incidents import mark_recommendation_available, upsert_wfm_incident
from app.concierge.services.metrics import worker_metrics
from app.concierge.services.recommendations import generate_recommendations
from app.concierge.services.wfm_actions import ui_actions_for_wfm_incident
from app.services.plan_helpers import plan_to_triage_dict
from app.services.plan_repository import load_all_plans
from app.services.triage import shr_gap, status_of, triage_plans

logger = logging.getLogger("concierge.portfolio_monitor")


async def run_portfolio_monitor(session: AsyncSession) -> int:
    """Scan all plans; create/update WFM incidents and recommendations (nudges on user context)."""
    plans_loaded = await load_all_plans(session)
    if not plans_loaded:
        return 0

    plan_dicts = [plan_to_triage_dict(p) for p in plans_loaded]
    buckets = triage_plans(plan_dicts)
    candidates: list[tuple[str, dict[str, Any]]] = []

    for item in buckets["dec"]:
        p = item.plan
        st = status_of(p)
        incident_type = "PLAN_CRITICAL_SHORT" if st == "critical" else "PLAN_DECISION_REQUIRED"
        if float(p.get("sustained", 0)) < -1 and st != "critical":
            incident_type = "PLAN_SUSTAINED_UNDER"
        signals = _plan_signals(p, item.why, bucket="decision")
        candidates.append((incident_type, signals))

        if float(p.get("minOUfwd", p.get("min_ou_fwd", 0))) < -6:
            fwd_signals = {**signals, "min_ou_fwd": float(p.get("minOUfwd", p.get("min_ou_fwd", 0)))}
            candidates.append(("FORWARD_OU_RISK", fwd_signals))

        if p.get("hasRosterGap") or p.get("cls"):
            candidates.append(("ROSTER_GAP", {**signals, "roster_gap": True}))

    for item in buckets["auto"]:
        p = item.plan
        sg = shr_gap(p)
        if sg > 10:
            signals = _plan_signals(p, item.why, bucket="autopilot", shrink_gap=sg)
            candidates.append(("SHRINKAGE_DRIFT", signals))

    seen_keys: set[str] = set()

    for incident_type, signals in candidates:
        dedupe_key = f"{signals.get('cap_id')}:{incident_type}"
        if dedupe_key in seen_keys:
            continue
        seen_keys.add(dedupe_key)

        incident, is_new = await upsert_wfm_incident(session, incident_type, signals)
        if not incident:
            continue

        if is_new:
            worker_metrics.detections_triggered += 1
            worker_metrics.incidents_created += 1

        rec = await _ensure_primary_recommendation(session, incident, incident_type, signals, is_new)
        if not rec:
            continue
        # Nudges are delivered when the user opens the relevant plan (context_monitor).

    await session.commit()
    return 0


async def _ensure_primary_recommendation(
    session: AsyncSession,
    incident,
    incident_type: str,
    signals: dict[str, Any],
    is_new: bool,
):
    existing_rec = (
        await session.execute(
            select(ConciergeRecommendation)
            .where(ConciergeRecommendation.incident_id == incident.id, ConciergeRecommendation.rank == 1)
            .order_by(ConciergeRecommendation.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    if existing_rec and not is_new:
        existing_rec.cap_id = signals.get("cap_id")
        existing_rec.program = signals.get("program")
        existing_rec.domain = "wfm"
        existing_rec.ui_actions = ui_actions_for_wfm_incident(incident_type, signals)
        return existing_rec

    recs = await generate_recommendations(session, incident)
    if not recs:
        return None

    rec = recs[0]
    rec.cap_id = signals.get("cap_id")
    rec.program = signals.get("program")
    rec.domain = "wfm"
    rec.ui_actions = ui_actions_for_wfm_incident(incident_type, signals)
    await mark_recommendation_available(session, incident.id)
    return rec


def _plan_signals(p: dict[str, Any], why: str, bucket: str, shrink_gap: float | None = None) -> dict[str, Any]:
    return {
        "cap_id": p.get("capId"),
        "plan_name": p.get("plan") or p.get("name"),
        "program": p.get("program"),
        "site": p.get("site"),
        "lob": p.get("lob"),
        "sustained": float(p.get("sustained", 0)),
        "min_ou_fwd": float(p.get("minOUfwd", p.get("min_ou_fwd", 0))),
        "shrink12": float(p.get("shrink12", 0)),
        "shrink_gap": shrink_gap,
        "bucket": bucket,
        "why": why,
        "has_roster_gap": bool(p.get("hasRosterGap") or p.get("cls")),
    }
