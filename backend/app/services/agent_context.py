"""Build live portfolio context for Vera from PostgreSQL."""

from __future__ import annotations

import json

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.plan_repository import load_all_plans, load_plan_detail, list_programs
from app.services.triage import triage_plans, status_of, shr_gap


async def build_agent_context(
    session: AsyncSession,
    *,
    active_cap_id: str | None = None,
    active_view: str | None = None,
    active_filter: str | None = None,
    active_tab: str | None = None,
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
        detail = await load_plan_detail(session, active_cap_id)
        if detail:
            st = status_of(
                {
                    "sustained": detail.sustained,
                    "minOUfwd": detail.min_ou_fwd,
                    "shrink12": detail.shrink12,
                    "curIdx": detail.cur_week_idx,
                    "sShrink": [w.shrink_actual for w in detail.weeks],
                }
            )
            sg = shr_gap(
                {
                    "curIdx": detail.cur_week_idx,
                    "sShrink": [w.shrink_actual for w in detail.weeks],
                    "shrink12": detail.shrink12,
                }
            )
            lines.extend(
                [
                    "",
                    f"UI FOCUS — DETAILED PLAN {detail.cap_id} ({detail.plan_name})",
                    f"  program={detail.program}, site={detail.site}, lob={detail.lob}, planner={detail.planner}",
                    f"  sustained={detail.sustained:.2f} FTE, status={st}, shrink12={detail.shrink12:.2f}%, shrink_gap={sg:.2f}pp",
                    f"  worst forward week={detail.min_ou_fwd:.2f}, roster gap={detail.has_roster_gap}",
                    f"  closing FTE={detail.closing_fte:.2f}, billable={detail.billable:.2f}",
                ]
            )
            if detail.weeks:
                fwd = detail.weeks[detail.cur_week_idx : detail.cur_week_idx + 5]
                lines.append("  forward weeks (label, O/U, shrink actual/plan):")
                for w in fwd:
                    lines.append(
                        f"    wk {w.week_label}: O/U {w.ou:+.2f}, shrink {w.shrink_actual or '—'}/{w.shrink_plan or '—'}%"
                    )

    if active_view:
        lines.append(f"Current UI view: {active_view}")
    if active_tab:
        lines.append(f"Active plan tab: {active_tab}")
    if active_filter and active_filter != "all":
        lines.append(f"Active program filter: {active_filter}")

    return "\n".join(lines)


def context_as_user_prefix(context: str, message: str, ui_state: dict | None = None) -> str:
    payload = {"portfolio": context, "ui_state": ui_state or {}, "planner_message": message}
    return json.dumps(payload, indent=2)
