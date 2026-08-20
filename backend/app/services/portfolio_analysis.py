"""Background portfolio analysis — staged recommendations per architecture."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.plan_repository import load_all_plans
from app.services.triage import triage_plans


@dataclass
class StagedRecommendation:
    cap_id: str
    plan_name: str
    program: str
    bucket: str
    why: str
    suggested_actions: list[str] = field(default_factory=list)


@dataclass
class PortfolioSnapshot:
    analyzed_at: str
    plan_count: int
    decision_count: int
    autopilot_count: int
    quiet_count: int
    recommendations: list[StagedRecommendation]


_cache: PortfolioSnapshot | None = None


async def analyze_portfolio(session: AsyncSession) -> PortfolioSnapshot:
    global _cache
    plans = await load_all_plans(session)
    plan_dicts = []
    for loaded in plans:
        meta = loaded.meta
        plan_dicts.append(
            {
                "capId": loaded.cap_id,
                "name": loaded.hierarchy.cp_plan_name,
                "program": loaded.hierarchy.program_name or meta.get("program", ""),
                "sustained": float(meta.get("sustained", 0)),
                "minOUfwd": float(meta.get("minOUfwd", 0)),
                "shrink12": float(meta.get("shrink12", 0)),
                "curIdx": int(meta.get("curIdx", 0)),
                "weeks": meta.get("weeks") or [],
                "sShrink": meta.get("sShrink") or meta.get("sShrinkPlan") or [],
            }
        )

    buckets = triage_plans(plan_dicts)
    recs: list[StagedRecommendation] = []

    for item in buckets["dec"]:
        p = item.plan
        actions = ["open_plan", "review_tabs"]
        if p.get("hasRosterGap"):
            actions.append("map_roster")
        if p["sustained"] < -1:
            actions.extend(["open_shrinkage", "review_recommendation"])
        recs.append(
            StagedRecommendation(
                cap_id=p["capId"],
                plan_name=p["name"],
                program=p["program"],
                bucket="decision",
                why=item.why,
                suggested_actions=actions,
            )
        )

    for item in buckets["auto"]:
        p = item.plan
        recs.append(
            StagedRecommendation(
                cap_id=p["capId"],
                plan_name=p["name"],
                program=p["program"],
                bucket="autopilot",
                why=item.why,
                suggested_actions=["open_plan", "adjust_shrinkage"],
            )
        )

    snap = PortfolioSnapshot(
        analyzed_at=datetime.now(timezone.utc).isoformat(),
        plan_count=len(plan_dicts),
        decision_count=len(buckets["dec"]),
        autopilot_count=len(buckets["auto"]),
        quiet_count=len(buckets["quiet"]),
        recommendations=recs,
    )
    _cache = snap
    return snap


def get_cached_snapshot() -> PortfolioSnapshot | None:
    return _cache
