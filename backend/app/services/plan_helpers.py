"""Helpers to convert loaded plans to prototype-compatible dicts for triage."""

from app.services.plan_repository import LoadedPlan, has_roster_gap


def plan_to_triage_dict(plan: LoadedPlan) -> dict:
    meta = plan.meta
    return {
        "capId": plan.cap_id,
        "plan": plan.hierarchy.cp_plan_name,
        "program": plan.hierarchy.program_name or meta.get("program", ""),
        "site": plan.hierarchy.site_name or meta.get("site", ""),
        "lob": plan.hierarchy.lob_name or meta.get("lob", ""),
        "sustained": float(meta.get("sustained", 0)),
        "minOUfwd": float(meta.get("minOUfwd", 0)),
        "shrink12": float(meta.get("shrink12", 0)),
        "curIdx": int(meta.get("curIdx", 0)),
        "weeks": plan.week_labels,
        "sShrink": plan.shrink_actual,
        "sShrinkPlan": plan.shrink_plan,
        "hasRosterGap": has_roster_gap(plan),
        "cls": meta.get("cls") if has_roster_gap(plan) else None,
    }


def _has_roster_gap(plan: LoadedPlan) -> bool:
    return has_roster_gap(plan)
