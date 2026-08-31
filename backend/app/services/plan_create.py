"""Create a new CAP plan with minimal seed data (hierarchy + weekly series + meta)."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import OneviewHeaderDetails, OneviewHierarchy, OneviewPlannerDataset, OneviewShrinkage
from app.schemas import CreatePlanRequest, PlanDetail
from app.services.demo_store import DEMO_PLAN_META, get_json_setting, set_json_setting
from app.services.plan_repository import (
    cp_to_cap,
    load_plan,
    plan_to_detail,
    update_plan_meta,
    week_dates_from_labels,
)

NOW = datetime.now(timezone.utc).replace(tzinfo=None)
DEFAULT_SHRINK = 20.0
DEFAULT_FTE = 50.0
SCENARIOS = {"base", "optimistic", "conservative"}


async def _week_template(session: AsyncSession) -> tuple[list[str], int]:
    from app.services.plan_repository import load_all_plans

    plans = await load_all_plans(session)
    if plans:
        p = plans[0]
        return list(p.week_labels), int(p.meta.get("curIdx", 0))
    labels = [
        "05/10", "05/17", "05/24", "05/31", "06/07", "06/14", "06/21", "06/28",
        "07/05", "07/12", "07/19", "07/26", "08/02", "08/09", "08/16", "08/23",
        "08/30", "09/06", "09/13", "09/20", "09/27", "10/04", "10/11", "10/18", "10/25",
    ]
    return labels, 12


async def _next_cp_plan_id(session: AsyncSession) -> int:
    row = (await session.execute(select(func.max(OneviewHierarchy.cp_plan_id)))).scalar_one_or_none()
    return int(row or 0) + 1


def _normalize_site(site: str) -> str:
    s = (site or "").strip()
    if s and not s.endswith("-"):
        s = f"{s}-"
    return s


def _scope(
    *,
    cap_id: str,
    program: str,
    lob: str,
    site: str,
    plan_name: str,
    vertical: str,
) -> dict:
    return {
        "capability_id": cap_id,
        "organization": "Demo Org",
        "business_entity": vertical or program,
        "vertical": vertical or program,
        "program": program,
        "lob": lob,
        "sub_lob": lob,
        "activity": plan_name,
        "site": site,
    }


async def create_plan(session: AsyncSession, body: CreatePlanRequest) -> PlanDetail:
    cp_plan_id = await _next_cp_plan_id(session)
    cap_id = cp_to_cap(cp_plan_id)
    weeks, cur_idx = await _week_template(session)
    dates = week_dates_from_labels(weeks)

    plan_name = (body.plan_name or "").strip()
    if not plan_name:
        raise ValueError("plan_name is required")

    site = _normalize_site(body.site)
    lob = (body.lob or "").strip() or "General"
    program = (body.program or "").strip()
    if not program:
        raise ValueError("Organization (program) is required")
    vertical = (body.vertical or "").strip() or program
    skill = (body.skill or "").strip()
    channel = (body.channel or "").strip()
    planning_period = (body.planning_period or "").strip()
    scenario = (body.scenario or "Base").strip()
    if scenario.lower() not in SCENARIOS:
        scenario = "Base"
    else:
        scenario = scenario.capitalize()

    planner = (body.planner or "").strip() or "Planner"
    region = (body.region or "").strip() or "AMERICAS"
    billable = float(body.billable or DEFAULT_FTE)
    closing = float(body.closing_fte or DEFAULT_FTE)

    scope = _scope(
        cap_id=cap_id,
        program=program,
        lob=lob,
        site=site,
        plan_name=plan_name,
        vertical=vertical,
    )

    session.add(
        OneviewHierarchy(
            cp_plan_id=cp_plan_id,
            capability_id=cap_id,
            cp_plan_name=plan_name,
            cp_plan_start_date=dates[0] if dates else None,
            cp_plan_end_date=dates[-1] if dates else None,
            cp_plan_type_id=1,
            cp_plan_type="FTE",
            first_day_of_week="Sunday",
            map_activity_id=cp_plan_id,
            map_id=cp_plan_id,
            organization_id=1,
            business_entity_id=1,
            vertical_id=1,
            program_id=cp_plan_id,
            lob_id=cp_plan_id,
            sub_lob_id=cp_plan_id,
            activity_id=cp_plan_id,
            partner_id=1,
            site_id=cp_plan_id,
            location_id=cp_plan_id,
            country_id=1,
            region_id=1,
            organization_name="Demo Org",
            business_entity_name=vertical,
            vertical_name=vertical,
            program_name=program,
            lob_name=lob,
            sub_lob_name=lob,
            activity_name=plan_name,
            partner_name="Demo Partner",
            site_name=site,
            location_name=site.rstrip("-"),
            country_name=region,
            region_name=region,
            is_captive=1,
            hierarchy=f"{program} / {lob} / {site}",
            planner=planner,
            manager=planner,
            director="Demo Director",
        )
    )

    hc_cur = {
        "opening": closing,
        "nest": 0.0,
        "tin": 0.0,
        "tout": 0.0,
        "loaIn": 0.0,
        "loaOut": 0.0,
        "attr": 0.0,
        "promo": 0.0,
        "closing": closing,
    }

    for idx, week_date in enumerate(dates):
        req = billable * (1 + DEFAULT_SHRINK / 100.0)
        for kpi_key, value in (
            ("Billable_FTE_Projected", closing),
            ("Billable_FTE_Required", req),
            ("FTE_Over_Under", 0.0),
        ):
            session.add(
                OneviewPlannerDataset(
                    cp_plan_id=cp_plan_id,
                    date=week_date,
                    kpi_key=kpi_key,
                    value=float(value),
                    last_updated_on_utc=NOW,
                    **scope,
                )
            )
        for title_type in ("Actual", "Plan"):
            session.add(
                OneviewShrinkage(
                    cp_plan_id=cp_plan_id,
                    date=week_date,
                    shrinkage_type="Total",
                    shrinkage_subtype="All",
                    segment="All",
                    title_type=title_type,
                    percent_value=DEFAULT_SHRINK,
                    hours_value=round(billable * (DEFAULT_SHRINK / 100.0) * 40.0, 2),
                    is_billable=True,
                    is_hide=False,
                    is_nesting=False,
                    last_updated_on_utc=NOW,
                    **scope,
                )
            )

    cur_date = dates[cur_idx] if dates and 0 <= cur_idx < len(dates) else None
    if cur_date:
        for ref_code, api_key in (
            ("opening", "opening"),
            ("nest", "nest"),
            ("tin", "tin"),
            ("tout", "tout"),
            ("loa_in", "loaIn"),
            ("loa_out", "loaOut"),
            ("attr", "attr"),
            ("promo", "promo"),
            ("closing", "closing"),
        ):
            session.add(
                OneviewHeaderDetails(
                    cp_plan_id=cp_plan_id,
                    dataset_type="Headcount",
                    date=cur_date,
                    ref_code=ref_code,
                    kpi_group="Headcount",
                    type="HC",
                    sub_type=ref_code,
                    title=ref_code,
                    title_type="Actual",
                    unit="FTE",
                    value=float(hc_cur[api_key]),
                    last_updated_on_utc=NOW,
                    **scope,
                )
            )
        for ref_code, value, unit in (
            ("ou", 0.0, "FTE"),
            ("sustained", 0.0, "FTE"),
            ("minOUfwd", 0.0, "FTE"),
            ("closingFTE", closing, "FTE"),
            ("shrink12", DEFAULT_SHRINK, "Pct"),
            ("attr12", 0.0, "Pct"),
            ("availHrs", 40.0, "Hours"),
        ):
            session.add(
                OneviewHeaderDetails(
                    cp_plan_id=cp_plan_id,
                    dataset_type="Summary",
                    date=cur_date,
                    ref_code=ref_code,
                    kpi_group="Summary",
                    type="KPI",
                    sub_type=ref_code,
                    title=ref_code,
                    title_type="Actual",
                    unit=unit,
                    value=float(value),
                    last_updated_on_utc=NOW,
                    **scope,
                )
            )

    await update_plan_meta(
        session,
        cap_id,
        {
            "weeks": weeks,
            "curIdx": cur_idx,
            "ou": 0.0,
            "sustained": 0.0,
            "minOUfwd": 0.0,
            "closingFTE": closing,
            "availHrs": 40.0,
            "shrink12": DEFAULT_SHRINK,
            "attr12": 0.0,
            "hire12": 0.0,
            "billable": billable,
            "isVol": False,
            "region": region,
            "program": program,
            "site": site,
            "lob": lob,
            "planner": planner,
            "vertical": vertical,
            "skill": skill,
            "channel": channel,
            "planningPeriod": planning_period,
            "scenario": scenario,
            "hcCur": hc_cur,
            "hcLast": {**hc_cur, "nest": 0, "tin": 0, "tout": 0, "loaIn": 0, "loaOut": 0, "attr": 0, "promo": 0},
            "cls": {"status": "missing", "plan": 0, "actual": 0, "trainHC": 0},
        },
    )

    await session.flush()
    plan = await load_plan(session, cap_id)
    if not plan:
        raise RuntimeError("Plan created but could not be loaded")
    return plan_to_detail(plan)
