"""Build live portfolio context for Vera from PostgreSQL."""

from __future__ import annotations

import json

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.plan_repository import load_all_plans, load_plan_summary, list_programs
from app.services.triage import triage_plans


async def build_agent_context(
    session: AsyncSession,
    *,
    active_cap_id: str | None = None,
    active_view: str | None = None,
    active_filter: str | None = None,
) -> str:
    plans = await load_all_plans(session)
    if not plans:
        return "Portfolio is empty — no plans loaded from database."

    plan_dicts = []
    for loaded in plans:
        meta = loaded.meta
        plan_dicts.append(
            {
                "capId": loaded.cap_id,
                "name": loaded.hierarchy.cp_plan_name,
                "program": loaded.hierarchy.program_name or meta.get("program", ""),
                "lob": loaded.hierarchy.lob_name or meta.get("lob", ""),
                "site": loaded.hierarchy.site_name or meta.get("site", ""),
                "planner": loaded.hierarchy.planner or meta.get("planner", ""),
                "sustained": float(meta.get("sustained", 0)),
                "minOUfwd": float(meta.get("minOUfwd", 0)),
                "ou": float(meta.get("ou", 0)),
                "shrink12": float(meta.get("shrink12", 0)),
                "curIdx": int(meta.get("curIdx", 0)),
                "weeks": meta.get("weeks") or [],
                "sShrink": meta.get("sShrink") or meta.get("sShrinkPlan") or [],
                "hasRosterGap": any((r.class_status or "") == "missing" for r in loaded.roster_rows)
                or bool(meta.get("cls") and meta.get("cls", {}).get("status") == "missing"),
            }
        )

    buckets = triage_plans(plan_dicts)
    programs = await list_programs(session)

    lines = [
        "LIVE PORTFOLIO (PostgreSQL, week of 08/02/2026)",
        f"Total plans: {len(plan_dicts)}",
        f"Programs: {', '.join(f'{p.name} ({p.plan_count} plans, net O/U {p.net_ou:+.2f})' for p in programs)}",
        "",
        f"NEEDS DECISION ({len(buckets['dec'])}):",
    ]
    for item in buckets["dec"][:8]:
        p = item.plan
        lines.append(
            f"  - {p['capId']} {p['name']} | {p['program']} | sustained {p['sustained']:.2f} FTE | {item.why}"
        )

    lines.append(f"\nAGENT CAN HANDLE ({len(buckets['auto'])}):")
    for item in buckets["auto"][:8]:
        p = item.plan
        lines.append(f"  - {p['capId']} {p['name']} | {p['program']} | {item.why}")

    lines.append(f"\nQUIET / IN TOLERANCE ({len(buckets['quiet'])}):")
    for item in buckets["quiet"][:5]:
        p = item.plan
        lines.append(f"  - {p['capId']} {p['name']} | {item.why}")

    if active_cap_id:
        summary = await load_plan_summary(session, active_cap_id)
        if summary:
            lines.extend(
                [
                    "",
                    f"UI FOCUS: plan {summary.cap_id} ({summary.plan_name})",
                    f"  program={summary.program}, sustained={summary.sustained:.2f}, shrink12={summary.shrink12:.2f}%, "
                    f"worst forward week={summary.min_ou_fwd:.2f}, roster gap={summary.has_roster_gap}",
                ]
            )

    if active_view:
        lines.append(f"Current UI view: {active_view}")
    if active_filter and active_filter != "all":
        lines.append(f"Active program filter: {active_filter}")

    return "\n".join(lines)


def context_as_user_prefix(context: str, message: str, ui_state: dict | None = None) -> str:
    payload = {"portfolio": context, "ui_state": ui_state or {}, "planner_message": message}
    return json.dumps(payload, indent=2)
