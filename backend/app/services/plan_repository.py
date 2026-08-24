"""Read Cape oneview tables and expose prototype-compatible plan DTOs."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import OneviewHeaderDetails, OneviewHierarchy, OneviewNewHire, OneviewPlannerDataset, OneviewShrinkage
from app.schemas import HeadcountOut, PlanDetail, PlanSummary, ProgramOut, RosterClassOut, WeekOut
from app.services.demo_store import DEMO_PLAN_META, get_json_setting, set_json_setting

KPI_OU = "FTE_Over_Under"
KPI_PROJ = "Billable_FTE_Projected"
KPI_REQ = "Billable_FTE_Required"

HC_REF_MAP = {
    "opening": "opening",
    "nest": "nest",
    "tin": "tin",
    "tout": "tout",
    "loaIn": "loa_in",
    "loaOut": "loa_out",
    "attr": "attr",
    "promo": "promo",
    "closing": "closing",
}


def cap_to_cp(cap_id: str) -> int:
    return int(cap_id.replace("CAP", ""))


def cp_to_cap(cp_plan_id: int) -> str:
    return f"CAP{cp_plan_id:05d}"


def week_dates_from_labels(labels: list[str]) -> list[date]:
    month, day = map(int, labels[0].split("/"))
    start = date(2026, month, day)
    return [start + timedelta(weeks=i) for i in range(len(labels))]


def avg_forward(vals: list, cur_idx: int, n: int = 12) -> float:
    chunk = [float(v) for v in vals[cur_idx : cur_idx + n] if v is not None]
    return round(sum(chunk) / len(chunk), 2) if chunk else 0.0


async def update_plan_meta(session: AsyncSession, cap_id: str, patch: dict) -> dict:
    all_meta = await get_json_setting(session, DEMO_PLAN_META, {})
    cur = dict(all_meta.get(cap_id) or {})
    cur.update(patch)
    all_meta[cap_id] = cur
    await set_json_setting(session, DEMO_PLAN_META, all_meta)
    return cur


@dataclass
class LoadedPlan:
    cap_id: str
    hierarchy: OneviewHierarchy
    meta: dict
    week_labels: list[str]
    week_dates: list[date]
    ou: list[float]
    projected: list[float]
    required: list[float]
    shrink_actual: list[float | None]
    shrink_plan: list[float | None]
    headcount: dict | None
    roster_rows: list[OneviewNewHire]


async def _plan_meta(session: AsyncSession) -> dict:
    return await get_json_setting(session, DEMO_PLAN_META, {})


async def load_plan(session: AsyncSession, cap_id: str) -> LoadedPlan | None:
    cp_id = cap_to_cp(cap_id)
    hierarchy = (
        await session.execute(select(OneviewHierarchy).where(OneviewHierarchy.cp_plan_id == cp_id))
    ).scalar_one_or_none()
    if not hierarchy:
        hierarchy = (
            await session.execute(select(OneviewHierarchy).where(OneviewHierarchy.capability_id == cap_id))
        ).scalar_one_or_none()
    if not hierarchy:
        return None

    all_meta = await _plan_meta(session)
    meta = all_meta.get(cap_id, {})
    week_labels = meta.get("weeks") or []
    if not week_labels:
        return None

    dates = week_dates_from_labels(week_labels)
    planner_rows = (
        await session.execute(
            select(OneviewPlannerDataset).where(OneviewPlannerDataset.cp_plan_id == hierarchy.cp_plan_id)
        )
    ).scalars().all()
    kpi_map = {(row.date, row.kpi_key): row.value for row in planner_rows}

    ou = [float(kpi_map.get((d, KPI_OU), 0) or 0) for d in dates]
    projected = [float(kpi_map.get((d, KPI_PROJ), 0) or 0) for d in dates]
    required = [float(kpi_map.get((d, KPI_REQ), 0) or 0) for d in dates]

    shrink_rows = (
        await session.execute(
            select(OneviewShrinkage).where(
                OneviewShrinkage.cp_plan_id == hierarchy.cp_plan_id,
                OneviewShrinkage.shrinkage_type == "Total",
            )
        )
    ).scalars().all()
    shrink_actual_map = {row.date: row.percent_value for row in shrink_rows if row.title_type == "Actual"}
    shrink_plan_map = {row.date: row.percent_value for row in shrink_rows if row.title_type == "Plan"}
    shrink_actual = [shrink_actual_map.get(d) for d in dates]
    shrink_plan = [shrink_plan_map.get(d) for d in dates]

    cur_idx = int(meta.get("curIdx", 0))
    cur_date = dates[cur_idx] if 0 <= cur_idx < len(dates) else dates[-1]
    hc_rows = (
        await session.execute(
            select(OneviewHeaderDetails).where(
                OneviewHeaderDetails.cp_plan_id == hierarchy.cp_plan_id,
                OneviewHeaderDetails.date == cur_date,
                OneviewHeaderDetails.dataset_type == "Headcount",
            )
        )
    ).scalars().all()
    hc_map = {row.ref_code: row.value for row in hc_rows}
    headcount: dict | None = None
    if hc_map:
        headcount = {HC_REF_MAP[k]: float(hc_map.get(k, 0) or 0) for k in HC_REF_MAP}
    elif meta.get("hcCur"):
        hc = meta["hcCur"]
        headcount = {
            "opening": hc.get("opening", 0),
            "nest": hc.get("nest", 0),
            "tin": hc.get("tin", 0),
            "tout": hc.get("tout", 0),
            "loa_in": hc.get("loaIn", 0),
            "loa_out": hc.get("loaOut", 0),
            "attr": hc.get("attr", 0),
            "promo": hc.get("promo", 0),
            "closing": hc.get("closing", 0),
        }

    roster_rows = list(
        (
            await session.execute(select(OneviewNewHire).where(OneviewNewHire.capability_id == cap_id))
        ).scalars().all()
    )

    return LoadedPlan(
        cap_id=cap_id,
        hierarchy=hierarchy,
        meta=meta,
        week_labels=week_labels,
        week_dates=dates,
        ou=ou,
        projected=projected,
        required=required,
        shrink_actual=shrink_actual,
        shrink_plan=shrink_plan,
        headcount=headcount,
        roster_rows=roster_rows,
    )


def has_roster_gap(plan: LoadedPlan) -> bool:
    if any((row.class_status or "") == "missing" for row in plan.roster_rows):
        return True
    cls = plan.meta.get("cls")
    return bool(cls and cls.get("status") == "missing")


def live_hire12(plan: LoadedPlan) -> float:
    """Hiring · 12wk from mapped roster actuals (live), else meta/demo."""
    mapped = sum(
        float(row.actual_hc or 0)
        for row in plan.roster_rows
        if (row.class_status or "") in ("mapped", "uploaded", "partial")
    )
    if mapped > 0:
        return mapped
    cls = plan.meta.get("cls") or {}
    if (cls.get("status") or "") in ("mapped", "uploaded") and cls.get("actual") is not None:
        return float(cls.get("actual") or 0)
    return float(plan.meta.get("hire12", 0) or 0)


def live_s_hire(plan: LoadedPlan) -> list[float | None]:
    """Week series for hiring sparkline — stamp live hire onto current week when mapped."""
    n = len(plan.week_labels)
    raw = list(plan.meta.get("sHire") or [])
    series: list[float | None] = []
    for i in range(n):
        series.append(float(raw[i]) if i < len(raw) and raw[i] is not None else 0.0)
    hire = live_hire12(plan)
    if hire > 0:
        cur_idx = int(plan.meta.get("curIdx", 0))
        if 0 <= cur_idx < n:
            series[cur_idx] = hire
    return series


def plan_to_summary(plan: LoadedPlan) -> PlanSummary:
    meta = plan.meta
    h = plan.hierarchy
    cur_idx = int(meta.get("curIdx", 0))
    shrink12 = avg_forward(plan.shrink_plan, cur_idx)
    if not shrink12:
        shrink12 = float(meta.get("shrink12", 0))
    attr_plan = meta.get("sAttrPlan") or []
    attr12 = avg_forward(attr_plan, cur_idx) if attr_plan else float(meta.get("attr12", 0))
    return PlanSummary(
        cap_id=plan.cap_id,
        plan_name=h.cp_plan_name,
        program=h.program_name or meta.get("program", ""),
        site=h.site_name or meta.get("site", ""),
        region=meta.get("region", ""),
        lob=h.lob_name or meta.get("lob", ""),
        planner=h.planner or meta.get("planner", ""),
        vertical=h.vertical_name or meta.get("vertical", ""),
        is_vol=bool(meta.get("isVol", False)),
        cur_week_idx=cur_idx,
        ou=float(meta.get("ou", 0)),
        sustained=float(meta.get("sustained", 0)),
        min_ou_fwd=float(meta.get("minOUfwd", 0)),
        closing_fte=float(meta.get("closingFTE", 0)),
        shrink12=shrink12,
        attr12=attr12,
        billable=float(meta.get("billable", 50.0)),
        has_roster_gap=has_roster_gap(plan),
    )


def _roster_out(row: OneviewNewHire, meta_cls: dict | None) -> RosterClassOut:
    meta_cls = meta_cls or {}
    return RosterClassOut(
        id=row.id,
        class_name=row.class_reference or meta_cls.get("className", ""),
        class_date=meta_cls.get("date", row.induction_date.isoformat() if row.induction_date else ""),
        wk_rel=int(meta_cls.get("wkRel", 0)),
        plan_hc=float(row.plan_hc or 0),
        actual_hc=float(row.actual_hc or 0),
        train_hc=float(meta_cls.get("trainHC", row.plan_hc or 0)),
        status=row.class_status or meta_cls.get("status", "missing"),
        train_wk=int(meta_cls.get("trainWk", row.training_weeks or 2)),
        nest_wk=int(meta_cls.get("nestWk", row.nesting_weeks or 1)),
    )


def plan_to_detail(plan: LoadedPlan) -> PlanDetail:
    summary = plan_to_summary(plan)
    weeks = [
        WeekOut(
            week_idx=idx,
            week_label=label,
            ou=plan.ou[idx],
            shrink_actual=plan.shrink_actual[idx],
            shrink_plan=plan.shrink_plan[idx],
            projected=plan.projected[idx],
            required=plan.required[idx],
        )
        for idx, label in enumerate(plan.week_labels)
    ]
    meta = plan.meta
    meta_cls = meta.get("cls")
    roster = [_roster_out(row, meta_cls) for row in plan.roster_rows]
    hc_out = HeadcountOut(**plan.headcount) if plan.headcount else None
    n = len(plan.week_labels)
    return PlanDetail(
        **summary.model_dump(),
        avail_hrs=float(meta.get("availHrs", 40.0)),
        weeks=weeks,
        headcount=hc_out,
        roster_classes=roster,
        s_attr=list(meta.get("sAttr") or [None] * n),
        s_attr_plan=list(meta.get("sAttrPlan") or [None] * n),
        s_hire=live_s_hire(plan),
        s_fcst=meta.get("sFcst"),
        s_act_vol=meta.get("sActVol"),
        s_aht_goal=meta.get("sAhtGoal"),
        s_aht_act=meta.get("sAhtAct"),
        hire12=live_hire12(plan),
        ou_shrink=float(meta["ouShrink"]) if meta.get("ouShrink") is not None else None,
        f_bias=meta.get("fBias"),
        a_bias=meta.get("aBias"),
    )


async def load_all_plans(session: AsyncSession, program: str | None = None) -> list[LoadedPlan]:
    stmt = select(OneviewHierarchy).order_by(OneviewHierarchy.cp_plan_name)
    if program:
        stmt = stmt.where(OneviewHierarchy.program_name == program)
    hierarchies = list((await session.execute(stmt)).scalars().all())
    plans: list[LoadedPlan] = []
    for hierarchy in hierarchies:
        cap_id = hierarchy.capability_id or cp_to_cap(hierarchy.cp_plan_id)
        loaded = await load_plan(session, cap_id)
        if loaded:
            plans.append(loaded)
    return plans


async def load_plan_detail(session: AsyncSession, cap_id: str) -> PlanDetail | None:
    plan = await load_plan(session, cap_id)
    return plan_to_detail(plan) if plan else None


async def load_plan_summary(session: AsyncSession, cap_id: str) -> PlanSummary | None:
    plan = await load_plan(session, cap_id)
    return plan_to_summary(plan) if plan else None


async def list_programs(session: AsyncSession) -> list[ProgramOut]:
    plans = await load_all_plans(session)
    grouped: dict[str, list[LoadedPlan]] = {}
    for plan in plans:
        name = plan.hierarchy.program_name or plan.meta.get("program", "Unknown")
        grouped.setdefault(name, []).append(plan)

    out: list[ProgramOut] = []
    for idx, (name, items) in enumerate(sorted(grouped.items()), start=1):
        net_ou = sum(float(p.meta.get("ou", 0)) for p in items)
        out.append(ProgramOut(id=idx, name=name, plan_count=len(items), net_ou=round(net_ou, 2)))
    return out
