"""Read Cape oneview tables and expose prototype-compatible plan DTOs."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

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

ENRICHMENT_PATH = Path(__file__).resolve().parents[3] / "frontend" / "src" / "data" / "htmlPlanEnrichment.json"


@lru_cache(maxsize=1)
def _enrichment_by_cap() -> dict:
    if not ENRICHMENT_PATH.exists():
        return {}
    try:
        rows = json.loads(ENRICHMENT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {row.get("capId"): row for row in rows if row.get("capId")}


def _enrich(cap_id: str) -> dict:
    return _enrichment_by_cap().get(cap_id) or {}


def _pad_series(raw, n: int, fill=None) -> list:
    series = []
    raw = list(raw or [])
    for i in range(n):
        if i < len(raw) and raw[i] is not None:
            series.append(float(raw[i]))
        else:
            series.append(fill)
    return series


def week_index_for_date(dates: list[date], target: date | None) -> int | None:
    if not target or not dates:
        return None
    best = 0
    for i, week_date in enumerate(dates):
        if week_date <= target:
            best = i
        else:
            break
    return best


def cap_to_cp(cap_id: str) -> int:
    return int(cap_id.replace("CAP", ""))


def cp_to_cap(cp_plan_id: int) -> str:
    return f"CAP{cp_plan_id:05d}"


def week_dates_from_labels(labels: list[str]) -> list[date]:
    month, day = map(int, labels[0].split("/"))
    start = date(2026, month, day)
    return [start + timedelta(weeks=i) for i in range(len(labels))]


def display_fte_series(plan: "LoadedPlan") -> tuple[list[float], list[float]]:
    """Projected / O/U for API responses.

    If stored closingFTE lags the movement formula (seed inconsistency or
    unsaved HC math), shift current+forward weeks in memory only. Persistence
    happens on headcount save so we never double-apply.
    """
    proj = [float(v or 0) for v in plan.projected]
    ou = [float(v or 0) for v in plan.ou]
    computed = compute_closing_fte(plan.headcount) if plan.headcount else None
    stored = float(plan.meta.get("closingFTE") or 0)
    if computed is None or abs(computed - stored) < 0.0001:
        return proj, ou
    delta = round(computed - stored, 2)
    cur_idx = int(plan.meta.get("curIdx", 0))
    for i in range(max(0, cur_idx), len(proj)):
        proj[i] = round(proj[i] + delta, 2)
        if i < len(ou):
            ou[i] = round(ou[i] + delta, 2)
    return proj, ou


def compute_closing_fte(hc: dict | None) -> float:
    """Opening + nest + transfer in − transfer out + back from LOA − to LOA − attr − promo."""
    if not hc:
        return 0.0
    opening = float(hc.get("opening") or 0)
    nest = float(hc.get("nest") or 0)
    tin = float(hc.get("tin") or 0)
    tout = float(hc.get("tout") or 0)
    loa_out = float(hc.get("loa_out") or hc.get("loaOut") or 0)
    loa_in = float(hc.get("loa_in") or hc.get("loaIn") or 0)
    attr = float(hc.get("attr") or 0)
    promo = float(hc.get("promo") or 0)
    return round(opening + nest + tin - tout + loa_out - loa_in - attr - promo, 2)


def header_rows_to_hc(rows) -> dict | None:
    if not rows:
        return None
    raw = {row.ref_code: row.value for row in rows}
    hc = {api_key: float(raw.get(ref, 0) or 0) for ref, api_key in HC_REF_MAP.items()}
    hc["closing"] = compute_closing_fte(hc)
    return hc


def meta_hc_to_api(hc_meta: dict | None) -> dict | None:
    if not hc_meta:
        return None
    hc = {
        "opening": float(hc_meta.get("opening") or 0),
        "nest": float(hc_meta.get("nest") or 0),
        "tin": float(hc_meta.get("tin") or 0),
        "tout": float(hc_meta.get("tout") or 0),
        "loa_in": float(hc_meta.get("loaIn") or hc_meta.get("loa_in") or 0),
        "loa_out": float(hc_meta.get("loaOut") or hc_meta.get("loa_out") or 0),
        "attr": float(hc_meta.get("attr") or 0),
        "promo": float(hc_meta.get("promo") or 0),
        "closing": 0.0,
    }
    hc["closing"] = compute_closing_fte(hc)
    return hc


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
    headcount_last: dict | None
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
    prev_date = dates[cur_idx - 1] if cur_idx > 0 and cur_idx - 1 < len(dates) else None

    async def _hc_for_date(week_date):
        if not week_date:
            return None
        rows = (
            await session.execute(
                select(OneviewHeaderDetails).where(
                    OneviewHeaderDetails.cp_plan_id == hierarchy.cp_plan_id,
                    OneviewHeaderDetails.date == week_date,
                    OneviewHeaderDetails.dataset_type == "Headcount",
                )
            )
        ).scalars().all()
        return header_rows_to_hc(rows)

    headcount = await _hc_for_date(cur_date)
    if not headcount:
        headcount = meta_hc_to_api(meta.get("hcCur"))
    headcount_last = await _hc_for_date(prev_date)
    if not headcount_last:
        headcount_last = meta_hc_to_api(meta.get("hcLast")) or _enrich(cap_id).get("hcLast")
        if isinstance(headcount_last, dict) and "loa_in" not in headcount_last:
            headcount_last = meta_hc_to_api(headcount_last)

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
        headcount_last=headcount_last,
        roster_rows=roster_rows,
    )


def has_roster_gap(plan: LoadedPlan) -> bool:
    if any((row.class_status or "") == "missing" for row in plan.roster_rows):
        return True
    cls = plan.meta.get("cls")
    return bool(cls and cls.get("status") == "missing")


def live_s_attr(plan: LoadedPlan) -> list[float | None]:
    """Weekly production attrition % — meta/enrichment, with this-week HC overlay."""
    n = len(plan.week_labels)
    enrich = _enrich(plan.cap_id)
    raw = plan.meta.get("sAttr")
    if raw is None:
        raw = enrich.get("sAttr")
    series = _pad_series(raw, n, 0.0)
    cur_idx = int(plan.meta.get("curIdx", 0))
    hc = plan.headcount or {}
    opening = float(hc.get("opening") or 0)
    attr_hc = float(hc.get("attr") or 0)
    if opening > 0 and 0 <= cur_idx < n:
        series[cur_idx] = round((attr_hc / opening) * 100.0, 2)
    return series


def live_s_attr_plan(plan: LoadedPlan) -> list[float | None]:
    """Planned attrition % by week. Submitted meta wins; otherwise seed/attr12.

    A single forward week equal to 12× attr12 is a compressed leftover (the
    12-wk average dumped into this week). Expand it to a flat weekly plan.
    Empty forward weeks fill with attr12 so sliders are a real 12-wk series.
    """
    n = len(plan.week_labels)
    enrich = _enrich(plan.cap_id)
    raw = plan.meta.get("sAttrPlan")
    if raw is None:
        raw = enrich.get("sAttrPlan")
    series = _pad_series(raw, n, 0.0)
    cur_idx = int(plan.meta.get("curIdx", 0))
    rate = float(plan.meta.get("attr12") or enrich.get("attr12") or 0)
    horizon = min(12, max(0, n - cur_idx))
    fwd = series[cur_idx : cur_idx + horizon]
    nonzero = [float(v) for v in fwd if v]
    if rate and horizon and len(nonzero) == 1 and abs(nonzero[0] - rate * horizon) < 0.2:
        for i in range(cur_idx, cur_idx + horizon):
            series[i] = round(rate, 2)
        return series
    if rate and not nonzero:
        for i in range(cur_idx, n):
            series[i] = round(rate, 2)
    return series


def _class_week_idx(plan: "LoadedPlan", row, meta_cls: dict | None) -> int | None:
    meta_cls = meta_cls or {}
    target = row.planned_start_date or row.training_start_date or row.induction_date
    idx = week_index_for_date(plan.week_dates, target)
    if idx is None:
        cur_idx = int(plan.meta.get("curIdx", 0))
        idx = cur_idx + int(meta_cls.get("wkRel", 0) or 0)
    n = len(plan.week_labels)
    if idx < 0 or idx >= n:
        return None
    return idx


def live_s_hire(plan: LoadedPlan) -> list[float | None]:
    """Weekly new-hire HC — only mapped / uploaded classes hit the series."""
    n = len(plan.week_labels)
    enrich = _enrich(plan.cap_id)
    raw = plan.meta.get("sHire")
    if raw is None:
        raw = enrich.get("sHire")
    series = _pad_series(raw, n, 0.0)
    meta_cls = plan.meta.get("cls") or {}

    for row in plan.roster_rows:
        status = (row.class_status or meta_cls.get("status") or "").lower()
        mapped = status in ("mapped", "uploaded", "partial", "planned")
        if not mapped:
            continue
        hc = float(row.actual_hc or row.plan_hc or 0)
        if hc <= 0:
            continue
        idx = _class_week_idx(plan, row, meta_cls)
        if idx is None:
            continue
        series[idx] = hc
    return series


def live_hire12(plan: LoadedPlan) -> float:
    """Hiring · 12wk = mapped new-hire HC in the 16-wk sparkline window."""
    series = live_s_hire(plan)
    cur_idx = int(plan.meta.get("curIdx", 0))
    start = max(0, cur_idx - 8)
    return round(sum(float(v or 0) for v in series[start : cur_idx + 8]), 2)


def live_n_classes_12(plan: LoadedPlan) -> int:
    """Classes whose start week falls in this week through +11."""
    cur = int(plan.meta.get("curIdx", 0))
    meta_cls = plan.meta.get("cls") or {}
    n = 0
    for row in plan.roster_rows:
        idx = _class_week_idx(plan, row, meta_cls)
        if idx is not None and cur <= idx < cur + 12:
            n += 1
    return n


def plan_to_summary(plan: LoadedPlan) -> PlanSummary:
    meta = plan.meta
    h = plan.hierarchy
    cur_idx = int(meta.get("curIdx", 0))
    shrink12 = avg_forward(plan.shrink_plan, cur_idx)
    if not shrink12:
        shrink12 = float(meta.get("shrink12", 0))
    attr_plan = live_s_attr_plan(plan)
    attr12 = avg_forward(attr_plan, cur_idx) if attr_plan else float(meta.get("attr12", 0))
    _proj, live_ou_series = display_fte_series(plan)
    live_ou = float(live_ou_series[cur_idx]) if 0 <= cur_idx < len(live_ou_series) else float(meta.get("ou", 0))
    fwd_ou = [float(v) for v in live_ou_series[cur_idx : cur_idx + 12] if v is not None]
    sustained = round(sum(fwd_ou) / len(fwd_ou), 2) if fwd_ou else float(meta.get("sustained", 0))
    min_ou_fwd = round(min(fwd_ou), 2) if fwd_ou else float(meta.get("minOUfwd", 0))
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
        ou=live_ou,
        sustained=sustained,
        min_ou_fwd=min_ou_fwd,
        closing_fte=compute_closing_fte(plan.headcount) if plan.headcount else float(meta.get("closingFTE", 0)),
        shrink12=shrink12,
        attr12=attr12,
        billable=float(meta.get("billable", 50.0)),
        has_roster_gap=has_roster_gap(plan),
    )


def _roster_out(row: OneviewNewHire, meta_cls: dict | None) -> RosterClassOut:
    meta_cls = meta_cls or {}
    status = row.class_status or meta_cls.get("status", "missing")
    return RosterClassOut(
        id=row.id,
        class_name=row.class_reference or meta_cls.get("className", "") or meta_cls.get("name", ""),
        class_date=meta_cls.get("date", row.induction_date.isoformat() if row.induction_date else ""),
        wk_rel=int(meta_cls.get("wkRel", 0)),
        plan_hc=float(row.plan_hc or 0),
        actual_hc=float(row.actual_hc or 0),
        train_hc=float(meta_cls.get("trainHC", row.plan_hc or 0)),
        status=status,
        train_wk=int(meta_cls.get("trainWk", row.training_weeks or 2)),
        nest_wk=int(meta_cls.get("nestWk", row.nesting_weeks or 1)),
        roster_file=meta_cls.get("rosterFile"),
        employee_count=int(meta_cls.get("rosterEmployees") or 0),
    )


def _hc_out(hc: dict | None) -> HeadcountOut | None:
    if not hc:
        return None
    api = hc if "loa_in" in hc else meta_hc_to_api(hc)
    return HeadcountOut(**api) if api else None


def plan_to_detail(plan: LoadedPlan) -> PlanDetail:
    summary = plan_to_summary(plan)
    proj, ou = display_fte_series(plan)
    weeks = [
        WeekOut(
            week_idx=idx,
            week_label=label,
            ou=ou[idx] if idx < len(ou) else plan.ou[idx],
            shrink_actual=plan.shrink_actual[idx],
            shrink_plan=plan.shrink_plan[idx],
            projected=proj[idx] if idx < len(proj) else plan.projected[idx],
            required=plan.required[idx],
        )
        for idx, label in enumerate(plan.week_labels)
    ]
    meta = plan.meta
    meta_cls = meta.get("cls")
    roster = [_roster_out(row, meta_cls) for row in plan.roster_rows]
    hc_out = _hc_out(plan.headcount)
    hc_last_out = _hc_out(plan.headcount_last)
    return PlanDetail(
        **summary.model_dump(),
        avail_hrs=float(meta.get("availHrs", 40.0)),
        weeks=weeks,
        headcount=hc_out,
        headcount_last=hc_last_out,
        roster_classes=roster,
        s_attr=live_s_attr(plan),
        s_attr_plan=live_s_attr_plan(plan),
        s_hire=live_s_hire(plan),
        s_fcst=meta.get("sFcst") or _enrich(plan.cap_id).get("sFcst"),
        s_act_vol=meta.get("sActVol") or _enrich(plan.cap_id).get("sActVol"),
        s_aht_goal=meta.get("sAhtGoal") or _enrich(plan.cap_id).get("sAhtGoal"),
        s_aht_act=meta.get("sAhtAct") or _enrich(plan.cap_id).get("sAhtAct"),
        hire12=live_hire12(plan),
        n_classes_12=live_n_classes_12(plan),
        ou_shrink=float(ou[summary.cur_week_idx]) if 0 <= summary.cur_week_idx < len(ou) else (
            float(meta["ouShrink"]) if meta.get("ouShrink") is not None else None
        ),
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
        net_ou = 0.0
        for p in items:
            cur = int(p.meta.get("curIdx", 0))
            net_ou += float(p.ou[cur]) if 0 <= cur < len(p.ou) else float(p.meta.get("ou", 0))
        out.append(ProgramOut(id=idx, name=name, plan_count=len(items), net_ou=round(net_ou, 2)))
    return out
