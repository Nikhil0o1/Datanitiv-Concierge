from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import OneviewNewHire, OneviewPlannerDataset, OneviewShrinkage
from app.schemas import (
    RosterMapRequest,
    RosterMapResponse,
    ShrinkageSubmitRequest,
    ShrinkageSubmitResponse,
    WeekOut,
)
from app.services.plan_repository import KPI_OU, KPI_PROJ, KPI_REQ, cap_to_cp, load_plan
from app.services.shrinkage import req_of

router = APIRouter(prefix="/plans", tags=["plan-actions"])


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
        updated_weeks.append(
            WeekOut(
                week_idx=item.week_idx,
                week_label=label,
                ou=plan.ou[item.week_idx],
                shrink_actual=plan.shrink_actual[item.week_idx],
                shrink_plan=item.shrink_plan,
                projected=plan.projected[item.week_idx],
                required=new_req,
            )
        )

    await session.commit()
    return ShrinkageSubmitResponse(
        cap_id=cap_id,
        updated_weeks=sorted(updated_weeks, key=lambda w: w.week_idx),
        net_requirement_change=round(net_change, 2),
    )


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
    mapped_fte = body.train_hc if body.train_hc is not None else float(meta_cls.get("trainHC", roster.plan_hc or 0))
    roster.actual_hc = mapped_fte
    roster.class_status = "mapped"

    cp_plan_id = cap_to_cp(cap_id)
    cur_idx = int(plan.meta.get("curIdx", 0))
    projected_adjustment = mapped_fte

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
        if proj_row:
            proj_row.value = float(proj_row.value or 0) + mapped_fte
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
    )
