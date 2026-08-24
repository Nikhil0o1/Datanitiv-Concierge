from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from datetime import date, datetime

from app.models import (
    OneviewHeaderDetails,
    OneviewNewHire,
    OneviewPlannerDataset,
    OneviewRosterLog,
    OneviewShrinkage,
)
from app.schemas import (
    AttritionSubmitRequest,
    AttritionSubmitResponse,
    ForecastSubmitRequest,
    ForecastSubmitResponse,
    HeadcountOut,
    HeadcountUpdateRequest,
    HeadcountUpdateResponse,
    RosterMapRequest,
    RosterMapResponse,
    ShrinkageSubmitRequest,
    ShrinkageSubmitResponse,
    WeekOut,
)
from app.services.plan_repository import (
    HC_REF_MAP,
    KPI_OU,
    KPI_PROJ,
    KPI_REQ,
    avg_forward,
    cap_to_cp,
    load_plan,
    update_plan_meta,
)
from app.services.shrinkage import req_of

router = APIRouter(prefix="/plans", tags=["plan-actions"])

# reverse map: API field -> header ref_code
HC_API_TO_REF = {v: k for k, v in HC_REF_MAP.items()}


async def _reflow_ou_for_week(session, cp_plan_id, week_date, projected, required, plan, idx):
    ou_val = float(projected) - float(required)
    ou_row = (
        await session.execute(
            select(OneviewPlannerDataset).where(
                OneviewPlannerDataset.cp_plan_id == cp_plan_id,
                OneviewPlannerDataset.date == week_date,
                OneviewPlannerDataset.kpi_key == KPI_OU,
            )
        )
    ).scalar_one_or_none()
    if ou_row:
        ou_row.value = ou_val
    plan.ou[idx] = ou_val
    return ou_val


@router.post("/{cap_id}/shrinkage", response_model=ShrinkageSubmitResponse)
async def submit_shrinkage(
    cap_id: str,
    body: ShrinkageSubmitRequest,
    session: AsyncSession = Depends(get_db),
):
    plan = await load_plan(session, cap_id)
    if not plan:
        raise HTTPException(status_code=404, detail=f"Plan {cap_id} not found")

    cp_plan_id = cap_to_cp(cap_id)
    billable = float(plan.meta.get("billable", 50.0))
    week_map = {idx: (plan.week_labels[idx], plan.week_dates[idx]) for idx in range(len(plan.week_labels))}
    net_change = 0.0
    updated_weeks: list[WeekOut] = []

    for item in body.weeks:
        if item.week_idx not in week_map:
            raise HTTPException(status_code=400, detail=f"Week index {item.week_idx} not found")
        label, week_date = week_map[item.week_idx]
        old_shrink = plan.shrink_plan[item.week_idx] or 0.0
        old_req = req_of(billable, old_shrink)
        new_req = req_of(billable, item.shrink_plan)
        net_change += new_req - old_req

        row = (
            await session.execute(
                select(OneviewShrinkage).where(
                    OneviewShrinkage.cp_plan_id == cp_plan_id,
                    OneviewShrinkage.date == week_date,
                    OneviewShrinkage.shrinkage_type == "Total",
                    OneviewShrinkage.title_type == "Plan",
                )
            )
        ).scalar_one_or_none()
        if row:
            row.percent_value = item.shrink_plan
        else:
            session.add(
                OneviewShrinkage(
                    cp_plan_id=cp_plan_id,
                    capability_id=cap_id,
                    date=week_date,
                    shrinkage_type="Total",
                    shrinkage_subtype="All",
                    segment="All",
                    title_type="Plan",
                    percent_value=item.shrink_plan,
                    program=plan.hierarchy.program_name,
                    site=plan.hierarchy.site_name,
                )
            )

        req_row = (
            await session.execute(
                select(OneviewPlannerDataset).where(
                    OneviewPlannerDataset.cp_plan_id == cp_plan_id,
                    OneviewPlannerDataset.date == week_date,
                    OneviewPlannerDataset.kpi_key == KPI_REQ,
                )
            )
        ).scalar_one_or_none()
        if req_row:
            req_row.value = new_req

        plan.shrink_plan[item.week_idx] = item.shrink_plan
        plan.required[item.week_idx] = new_req
        ou_val = await _reflow_ou_for_week(
            session, cp_plan_id, week_date, plan.projected[item.week_idx], new_req, plan, item.week_idx
        )
        updated_weeks.append(
            WeekOut(
                week_idx=item.week_idx,
                week_label=label,
                ou=ou_val,
                shrink_actual=plan.shrink_actual[item.week_idx],
                shrink_plan=item.shrink_plan,
                projected=plan.projected[item.week_idx],
                required=new_req,
            )
        )

    cur_idx = int(plan.meta.get("curIdx", 0))
    shrink12 = avg_forward(plan.shrink_plan, cur_idx)
    fwd_ou = [float(v) for v in plan.ou[cur_idx : cur_idx + 12] if v is not None]
    meta_patch = {
        "shrink12": shrink12,
        "sustained": round(sum(fwd_ou) / len(fwd_ou), 2) if fwd_ou else plan.meta.get("sustained", 0),
        "minOUfwd": round(min(fwd_ou), 2) if fwd_ou else plan.meta.get("minOUfwd", 0),
    }
    await update_plan_meta(session, cap_id, meta_patch)
    await session.commit()
    return ShrinkageSubmitResponse(
        cap_id=cap_id,
        updated_weeks=sorted(updated_weeks, key=lambda w: w.week_idx),
        net_requirement_change=round(net_change, 2),
        shrink12=shrink12,
    )


@router.post("/{cap_id}/attrition", response_model=AttritionSubmitResponse)
async def submit_attrition(
    cap_id: str,
    body: AttritionSubmitRequest,
    session: AsyncSession = Depends(get_db),
):
    plan = await load_plan(session, cap_id)
    if not plan:
        raise HTTPException(status_code=404, detail=f"Plan {cap_id} not found")

    n = len(plan.week_labels)
    series = list(plan.meta.get("sAttrPlan") or [0.0] * n)
    while len(series) < n:
        series.append(0.0)

    for item in body.weeks:
        if item.week_idx < 0 or item.week_idx >= n:
            raise HTTPException(status_code=400, detail=f"Week index {item.week_idx} not found")
        series[item.week_idx] = float(item.attr_plan)

    cur_idx = int(plan.meta.get("curIdx", 0))
    attr12 = avg_forward(series, cur_idx)
    await update_plan_meta(session, cap_id, {"sAttrPlan": series, "attr12": attr12})
    await session.commit()
    return AttritionSubmitResponse(cap_id=cap_id, attr12=attr12, updated_count=len(body.weeks))


@router.post("/{cap_id}/forecast", response_model=ForecastSubmitResponse)
async def submit_forecast(
    cap_id: str,
    body: ForecastSubmitRequest,
    session: AsyncSession = Depends(get_db),
):
    plan = await load_plan(session, cap_id)
    if not plan:
        raise HTTPException(status_code=404, detail=f"Plan {cap_id} not found")
    if not plan.meta.get("isVol"):
        raise HTTPException(status_code=400, detail="Forecast submit is for volume-based plans only")

    patch = {}
    if body.fcst is not None:
        patch["sFcst"] = body.fcst
    if body.aht_goal is not None:
        patch["sAhtGoal"] = body.aht_goal
    if not patch:
        raise HTTPException(status_code=400, detail="No forecast fields to update")

    await update_plan_meta(session, cap_id, patch)
    await session.commit()
    return ForecastSubmitResponse(cap_id=cap_id, message="Forecast / AHT plan updated")


@router.post("/{cap_id}/headcount", response_model=HeadcountUpdateResponse)
async def update_headcount(
    cap_id: str,
    body: HeadcountUpdateRequest,
    session: AsyncSession = Depends(get_db),
):
    plan = await load_plan(session, cap_id)
    if not plan:
        raise HTTPException(status_code=404, detail=f"Plan {cap_id} not found")

    cp_plan_id = cap_to_cp(cap_id)
    cur_idx = int(plan.meta.get("curIdx", 0))
    cur_date = plan.week_dates[cur_idx] if plan.week_dates else None
    payload = body.model_dump(exclude_unset=True)

    # Prefer camelCase meta shape used by seed
    hc = dict(plan.meta.get("hcCur") or {})
    api_to_meta = {
        "opening": "opening",
        "nest": "nest",
        "tin": "tin",
        "tout": "tout",
        "loa_in": "loaIn",
        "loa_out": "loaOut",
        "attr": "attr",
        "promo": "promo",
        "closing": "closing",
    }
    for api_key, val in payload.items():
        meta_key = api_to_meta.get(api_key, api_key)
        hc[meta_key] = float(val)

    opening = float(hc.get("opening", 0) or 0)
    nest = float(hc.get("nest", 0) or 0)
    tin = float(hc.get("tin", 0) or 0)
    tout = float(hc.get("tout", 0) or 0)
    loa_out = float(hc.get("loaOut", 0) or 0)
    loa_in = float(hc.get("loaIn", 0) or 0)
    attr = float(hc.get("attr", 0) or 0)
    promo = float(hc.get("promo", 0) or 0)
    closing = round(opening + nest + tin - tout + loa_out - loa_in - attr - promo, 2)
    hc["closing"] = closing

    if cur_date is not None:
        for ref_code, api_field in HC_REF_MAP.items():
            meta_key = api_to_meta.get(api_field, api_field)
            value = float(hc.get(meta_key, 0) or 0)
            row = (
                await session.execute(
                    select(OneviewHeaderDetails).where(
                        OneviewHeaderDetails.cp_plan_id == cp_plan_id,
                        OneviewHeaderDetails.date == cur_date,
                        OneviewHeaderDetails.dataset_type == "Headcount",
                        OneviewHeaderDetails.ref_code == ref_code,
                    )
                )
            ).scalar_one_or_none()
            if row:
                row.value = value

    await update_plan_meta(session, cap_id, {"hcCur": hc, "closingFTE": closing})
    await session.commit()

    out = HeadcountOut(
        opening=opening,
        nest=nest,
        tin=tin,
        tout=tout,
        loa_in=loa_in,
        loa_out=loa_out,
        attr=attr,
        promo=promo,
        closing=closing,
    )
    return HeadcountUpdateResponse(cap_id=cap_id, headcount=out, message="Headcount movements saved")


@router.post("/{cap_id}/roster/map", response_model=RosterMapResponse)
async def map_roster(
    cap_id: str,
    body: RosterMapRequest,
    session: AsyncSession = Depends(get_db),
):
    plan = await load_plan(session, cap_id)
    if not plan:
        raise HTTPException(status_code=404, detail=f"Plan {cap_id} not found")

    roster: OneviewNewHire | None = None
    if body.class_id:
        roster = await session.get(OneviewNewHire, body.class_id)
        if not roster or roster.capability_id != cap_id:
            raise HTTPException(status_code=404, detail="Roster class not found for this plan")
    elif plan.roster_rows:
        roster = next((r for r in plan.roster_rows if (r.class_status or "") == "missing"), plan.roster_rows[0])
    else:
        raise HTTPException(status_code=400, detail="No roster class to map")

    meta_cls = plan.meta.get("cls") or {}
    employees = body.employees or []
    file_fte = sum(float(e.fte or 0) for e in employees) if employees else None
    if body.train_hc is not None:
        mapped_fte = float(body.train_hc)
    elif file_fte is not None and file_fte > 0:
        mapped_fte = float(file_fte)
    else:
        mapped_fte = float(meta_cls.get("trainHC", roster.plan_hc or 0))
    roster.actual_hc = mapped_fte
    roster.class_status = "mapped"
    meta_cls = {
        **meta_cls,
        "status": "mapped",
        "actual": mapped_fte,
        "trainHC": float(meta_cls.get("trainHC", mapped_fte) or mapped_fte),
    }
    if body.source_filename:
        meta_cls["rosterFile"] = body.source_filename
        meta_cls["rosterEmployees"] = len(employees)

    cp_plan_id = cap_to_cp(cap_id)
    cur_idx = int(plan.meta.get("curIdx", 0))
    prev_adj = float(plan.meta.get("rosterProjectedAdj") or 0)
    projected_adjustment = mapped_fte - prev_adj

    n = len(plan.week_labels)
    s_hire = list(plan.meta.get("sHire") or [0.0] * n)
    if len(s_hire) < n:
        s_hire = list(s_hire) + [0.0] * (n - len(s_hire))
    s_hire = [float(v or 0) for v in s_hire[:n]]
    if 0 <= cur_idx < n:
        s_hire[cur_idx] = mapped_fte

    await update_plan_meta(
        session,
        cap_id,
        {
            "cls": meta_cls,
            "hire12": mapped_fte,
            "sHire": s_hire,
            "rosterProjectedAdj": mapped_fte,
        },
    )

    class_ref = roster.class_reference or meta_cls.get("className") or ""
    for i, emp in enumerate(employees):
        eff = None
        if emp.hire_date:
            try:
                eff = date.fromisoformat(str(emp.hire_date)[:10])
            except ValueError:
                eff = None
        session.add(
            OneviewRosterLog(
                cp_plan_id=cp_plan_id,
                capability_id=cap_id,
                employee_id=emp.employee_id,
                work_status="Active",
                effective_date=eff or roster.planned_start_date or date.today(),
                class_reference=emp.class_reference or class_ref,
                hiring_sequence=i + 1,
                site=emp.location,
                program=plan.meta.get("program"),
                lob=plan.meta.get("lob"),
                synced_at=datetime.utcnow(),
            )
        )

    for idx, week_date in enumerate(plan.week_dates):
        if idx < cur_idx:
            continue
        proj_row = (
            await session.execute(
                select(OneviewPlannerDataset).where(
                    OneviewPlannerDataset.cp_plan_id == cp_plan_id,
                    OneviewPlannerDataset.date == week_date,
                    OneviewPlannerDataset.kpi_key == KPI_PROJ,
                )
            )
        ).scalar_one_or_none()
        ou_row = (
            await session.execute(
                select(OneviewPlannerDataset).where(
                    OneviewPlannerDataset.cp_plan_id == cp_plan_id,
                    OneviewPlannerDataset.date == week_date,
                    OneviewPlannerDataset.kpi_key == KPI_OU,
                )
            )
        ).scalar_one_or_none()
        if proj_row and projected_adjustment:
            proj_row.value = float(proj_row.value or 0) + projected_adjustment
            plan.projected[idx] = float(proj_row.value)
        if ou_row:
            ou_row.value = plan.projected[idx] - plan.required[idx]
            plan.ou[idx] = float(ou_row.value)

    await session.commit()
    return RosterMapResponse(
        cap_id=cap_id,
        mapped_fte=mapped_fte,
        projected_adjustment=projected_adjustment,
        status="mapped",
        employee_count=len(employees),
        source_filename=body.source_filename,
    )
