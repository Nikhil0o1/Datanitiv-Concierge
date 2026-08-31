from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from datetime import date, datetime

from app.models import (
    OneviewAttritionAssumption,
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
    compute_closing_fte,
    live_s_attr,
    live_s_attr_plan,
    live_s_hire,
    load_all_plans,
    load_plan,
    update_plan_meta,
    week_index_for_date,
)
from app.services.shrinkage import req_of

router = APIRouter(prefix="/plans", tags=["plan-actions"])

# reverse map: API field -> header ref_code
HC_API_TO_REF = {v: k for k, v in HC_REF_MAP.items()}


async def _reflow_ou_for_week(session, cp_plan_id, week_date, projected, required, plan, idx):
    ou_val = round(float(projected) - float(required), 2)
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


async def _shift_projected_forward(session, plan, cp_plan_id: int, from_idx: int, delta: float) -> None:
    if abs(delta) < 0.0001:
        return
    for idx, week_date in enumerate(plan.week_dates):
        if idx < from_idx:
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
        if proj_row:
            proj_row.value = round(float(proj_row.value or 0) + delta, 2)
            plan.projected[idx] = float(proj_row.value)
        await _reflow_ou_for_week(session, cp_plan_id, week_date, plan.projected[idx], plan.required[idx], plan, idx)


@router.post("/{cap_id}/shrinkage", response_model=ShrinkageSubmitResponse)
async def submit_shrinkage(
    cap_id: str,
    body: ShrinkageSubmitRequest,
    request: Request,
    session: AsyncSession = Depends(get_db),
):
    from app.concierge.services.business_events import emit_business_event, session_id_from_request

    sid = session_id_from_request(request)
    endpoint = f"/api/plans/{cap_id}/shrinkage"
    plan = await load_plan(session, cap_id)
    if not plan:
        await emit_business_event(
            event_type="plan.shrinkage.failed",
            severity="error",
            session_id=sid,
            endpoint=endpoint,
            status_code=404,
            error_code="PLAN_NOT_FOUND",
            metadata={"cap_id": cap_id},
        )
        raise HTTPException(status_code=404, detail=f"Plan {cap_id} not found")

    cp_plan_id = cap_to_cp(cap_id)
    billable = float(plan.meta.get("billable", 50.0))
    week_map = {idx: (plan.week_labels[idx], plan.week_dates[idx]) for idx in range(len(plan.week_labels))}
    net_change = 0.0
    updated_weeks: list[WeekOut] = []

    for item in body.weeks:
        if item.week_idx not in week_map:
            await emit_business_event(
                event_type="plan.shrinkage.failed",
                severity="error",
                session_id=sid,
                endpoint=endpoint,
                status_code=400,
                error_code="INVALID_WEEK_INDEX",
                metadata={"cap_id": cap_id, "week_idx": item.week_idx},
            )
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
    live_ou = float(plan.ou[cur_idx]) if 0 <= cur_idx < len(plan.ou) else plan.meta.get("ou", 0)
    meta_patch = {
        "shrink12": shrink12,
        "ou": live_ou,
        "ouShrink": live_ou,
        "sustained": round(sum(fwd_ou) / len(fwd_ou), 2) if fwd_ou else plan.meta.get("sustained", 0),
        "minOUfwd": round(min(fwd_ou), 2) if fwd_ou else plan.meta.get("minOUfwd", 0),
    }
    await update_plan_meta(session, cap_id, meta_patch)
    await session.commit()
    await emit_business_event(
        event_type="plan.shrinkage.submitted",
        session_id=sid,
        endpoint=endpoint,
        status_code=200,
        metadata={"cap_id": cap_id, "weeks": len(updated_weeks)},
    )
    return ShrinkageSubmitResponse(
        cap_id=cap_id,
        updated_weeks=sorted(updated_weeks, key=lambda w: w.week_idx),
        net_requirement_change=round(net_change, 2),
        shrink12=shrink12,
    )


async def _write_projected(session, plan, cp_plan_id, idx, projected):
    week_date = plan.week_dates[idx]
    val = round(float(projected), 2)
    proj_row = (
        await session.execute(
            select(OneviewPlannerDataset).where(
                OneviewPlannerDataset.cp_plan_id == cp_plan_id,
                OneviewPlannerDataset.date == week_date,
                OneviewPlannerDataset.kpi_key == KPI_PROJ,
            )
        )
    ).scalar_one_or_none()
    if proj_row:
        proj_row.value = val
    plan.projected[idx] = val
    await _reflow_ou_for_week(session, cp_plan_id, week_date, val, plan.required[idx], plan, idx)


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
    old_series = list(live_s_attr_plan(plan))
    while len(old_series) < n:
        old_series.append(0.0)
    series = list(old_series)

    for item in body.weeks:
        if item.week_idx < 0 or item.week_idx >= n:
            raise HTTPException(status_code=400, detail=f"Week index {item.week_idx} not found")
        series[item.week_idx] = float(item.attr_plan)

    cur_idx = int(plan.meta.get("curIdx", 0))
    attr12 = avg_forward(series, cur_idx)
    opening = float((plan.headcount or {}).get("opening") or plan.meta.get("hcCur", {}).get("opening") or 0)
    orig_proj = [float(v or 0) for v in plan.projected]
    cp_plan_id = cap_to_cp(cap_id)

    cum = 0.0
    for idx in range(cur_idx, n):
        base_pct = float(old_series[idx] or 0)
        new_pct = float(series[idx] or 0)
        stock = opening if idx == cur_idx else orig_proj[idx]
        extra = stock * (new_pct - base_pct) / 100.0
        cum += extra
        await _write_projected(session, plan, cp_plan_id, idx, orig_proj[idx] - cum)

    fwd_ou = [float(v) for v in plan.ou[cur_idx : cur_idx + 12] if v is not None]
    live_ou = float(plan.ou[cur_idx]) if 0 <= cur_idx < len(plan.ou) else plan.meta.get("ou", 0)
    meta_patch = {
        "sAttrPlan": series,
        "attr12": attr12,
        "ou": live_ou,
        "ouShrink": live_ou,
        "sustained": round(sum(fwd_ou) / len(fwd_ou), 2) if fwd_ou else plan.meta.get("sustained", 0),
        "minOUfwd": round(min(fwd_ou), 2) if fwd_ou else plan.meta.get("minOUfwd", 0),
    }
    await update_plan_meta(session, cap_id, meta_patch)

    assume_rows = (
        await session.execute(
            select(OneviewAttritionAssumption).where(OneviewAttritionAssumption.map_activity_id == cp_plan_id)
        )
    ).scalars().all()
    for row in assume_rows:
        row.attrition_perc = attr12

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
    closing = compute_closing_fte(
        {
            "opening": opening,
            "nest": nest,
            "tin": tin,
            "tout": tout,
            "loa_out": loa_out,
            "loa_in": loa_in,
            "attr": attr,
            "promo": promo,
        }
    )
    hc["closing"] = closing

    old_closing = float((plan.headcount or {}).get("closing") or plan.meta.get("closingFTE") or 0)
    # Compare against persisted meta so a first save of an inconsistent seed still reflows O/U.
    stored_closing = float(plan.meta.get("closingFTE") or old_closing)
    delta = closing - stored_closing

    n = len(plan.week_labels)
    s_attr = list(live_s_attr(plan))
    if opening > 0 and 0 <= cur_idx < n:
        s_attr[cur_idx] = round((attr / opening) * 100.0, 2)

    h = plan.hierarchy
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
            else:
                session.add(
                    OneviewHeaderDetails(
                        cp_plan_id=cp_plan_id,
                        dataset_type="Headcount",
                        date=cur_date,
                        ref_code=ref_code,
                        kpi_group="Headcount",
                        type="Headcount",
                        sub_type=ref_code,
                        title=ref_code,
                        title_type="Actual",
                        unit="FTE",
                        value=value,
                        is_billable=True,
                        capability_id=cap_id,
                        program=h.program_name,
                        site=h.site_name,
                    )
                )

    await _shift_projected_forward(session, plan, cp_plan_id, cur_idx, delta)

    fwd_ou = [float(v) for v in plan.ou[cur_idx : cur_idx + 12] if v is not None]
    live_ou = float(plan.ou[cur_idx]) if 0 <= cur_idx < len(plan.ou) else 0.0
    await update_plan_meta(
        session,
        cap_id,
        {
            "hcCur": hc,
            "closingFTE": closing,
            "sAttr": s_attr,
            "ou": live_ou,
            "ouShrink": live_ou,
            "sustained": round(sum(fwd_ou) / len(fwd_ou), 2) if fwd_ou else plan.meta.get("sustained", 0),
            "minOUfwd": round(min(fwd_ou), 2) if fwd_ou else plan.meta.get("minOUfwd", 0),
        },
    )
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
    request: Request,
    session: AsyncSession = Depends(get_db),
):
    from app.concierge.services.business_events import emit_business_event, session_id_from_request

    sid = session_id_from_request(request)
    endpoint = f"/api/plans/{cap_id}/roster/map"
    plan = await load_plan(session, cap_id)
    if not plan:
        await emit_business_event(
            event_type="plan.roster.failed",
            severity="error",
            session_id=sid,
            endpoint=endpoint,
            status_code=404,
            error_code="PLAN_NOT_FOUND",
            metadata={"cap_id": cap_id},
        )
        raise HTTPException(status_code=404, detail=f"Plan {cap_id} not found")

    roster: OneviewNewHire | None = None
    if body.class_id:
        roster = await session.get(OneviewNewHire, body.class_id)
        if not roster or roster.capability_id != cap_id:
            await emit_business_event(
                event_type="plan.roster.failed",
                severity="error",
                session_id=sid,
                endpoint=endpoint,
                status_code=404,
                error_code="ROSTER_CLASS_NOT_FOUND",
                metadata={"cap_id": cap_id},
            )
            raise HTTPException(status_code=404, detail="Roster class not found for this plan")
    elif plan.roster_rows:
        roster = next((r for r in plan.roster_rows if (r.class_status or "") == "missing"), plan.roster_rows[0])
    else:
        await emit_business_event(
            event_type="plan.roster.failed",
            severity="error",
            session_id=sid,
            endpoint=endpoint,
            status_code=400,
            error_code="NO_ROSTER_CLASS",
            metadata={"cap_id": cap_id},
        )
        raise HTTPException(status_code=400, detail="No roster class to map")

    meta_cls = plan.meta.get("cls") or {}
    employees = body.employees or []
    file_fte = sum(float(e.fte or 0) for e in employees) if employees else None
    if body.train_hc is not None:
        mapped_fte = float(body.train_hc)
    elif file_fte is not None and file_fte > 0:
        mapped_fte = float(file_fte)
    else:
        mapped_fte = float(meta_cls.get("trainHC") or roster.plan_hc or 0)
    status = "uploaded" if body.source_filename else "mapped"
    roster.actual_hc = mapped_fte
    roster.class_status = status
    roster.billable_hc = mapped_fte
    roster.graduate_needed = max(0.0, float(roster.plan_hc or 0) - mapped_fte)
    meta_cls = {
        **meta_cls,
        "status": status,
        "actual": mapped_fte,
        "trainHC": float(meta_cls.get("trainHC") or mapped_fte or 0),
    }
    if body.source_filename:
        meta_cls["rosterFile"] = body.source_filename
        meta_cls["rosterEmployees"] = len(employees)
    else:
        meta_cls.pop("rosterFile", None)
        meta_cls["rosterEmployees"] = 0

    cp_plan_id = cap_to_cp(cap_id)
    cur_idx = int(plan.meta.get("curIdx", 0))
    prev_adj = float(plan.meta.get("rosterProjectedAdj") or 0)
    projected_adjustment = mapped_fte - prev_adj

    n = len(plan.week_labels)
    s_hire = list(live_s_hire(plan))
    if len(s_hire) < n:
        s_hire = list(s_hire) + [0.0] * (n - len(s_hire))
    s_hire = [float(v or 0) for v in s_hire[:n]]
    class_week = week_index_for_date(
        plan.week_dates, roster.planned_start_date or roster.training_start_date or roster.induction_date
    )
    if class_week is None:
        class_week = cur_idx + int(meta_cls.get("wkRel", 0) or 0)
    if 0 <= class_week < n:
        s_hire[class_week] = mapped_fte

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

    await _shift_projected_forward(session, plan, cp_plan_id, cur_idx, projected_adjustment)

    await session.commit()
    await emit_business_event(
        event_type="plan.roster.mapped",
        session_id=sid,
        endpoint=endpoint,
        status_code=200,
        metadata={"cap_id": cap_id, "mapped_fte": mapped_fte},
    )
    return RosterMapResponse(
        cap_id=cap_id,
        mapped_fte=mapped_fte,
        projected_adjustment=projected_adjustment,
        status=status,
        employee_count=len(employees),
        source_filename=body.source_filename,
    )


async def revert_ghost_roster_maps(session: AsyncSession) -> list[str]:
    """Unmap classes that were marked mapped with no uploaded file (seed / agent leftovers)."""
    reverted: list[str] = []
    plans = await load_all_plans(session)
    for plan in plans:
        roster = plan.roster_rows[0] if plan.roster_rows else None
        if not roster:
            continue
        status = (roster.class_status or (plan.meta.get("cls") or {}).get("status") or "").lower()
        if status not in ("mapped", "uploaded"):
            continue
        meta_cls = dict(plan.meta.get("cls") or {})
        if meta_cls.get("rosterFile"):
            continue
        prev_adj = float(plan.meta.get("rosterProjectedAdj") or roster.actual_hc or 0)
        roster.actual_hc = 0.0
        roster.class_status = "missing"
        roster.billable_hc = 0.0
        roster.actual_start_date = None
        meta_cls["status"] = "missing"
        meta_cls["actual"] = 0.0
        meta_cls.pop("rosterFile", None)
        meta_cls["rosterEmployees"] = 0
        s_hire = list(live_s_hire(plan))
        class_week = week_index_for_date(
            plan.week_dates, roster.planned_start_date or roster.training_start_date or roster.induction_date
        )
        if class_week is None:
            class_week = int(plan.meta.get("curIdx", 0)) + int(meta_cls.get("wkRel", 0) or 0)
        if 0 <= class_week < len(s_hire):
            s_hire[class_week] = 0.0
        await update_plan_meta(
            session,
            plan.cap_id,
            {
                "cls": meta_cls,
                "hire12": 0.0,
                "sHire": s_hire,
                "rosterProjectedAdj": 0.0,
            },
        )
        if abs(prev_adj) >= 0.0001:
            await _shift_projected_forward(session, plan, cap_to_cp(plan.cap_id), int(plan.meta.get("curIdx", 0)), -prev_adj)
        reverted.append(plan.cap_id)
    await session.commit()
    return reverted
