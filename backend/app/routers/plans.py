from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas import CreatePlanRequest, CreatePlanResponse, PlanDetail, PlanSummary, ProgramOut
from app.services.plan_create import create_plan
from app.services.plan_repository import (
    list_programs,
    load_all_plans,
    load_plan_detail,
    plan_to_summary,
)

router = APIRouter(tags=["plans"])


@router.get("/plans", response_model=list[PlanSummary])
async def list_plans(program: str | None = None, session: AsyncSession = Depends(get_db)):
    plans = await load_all_plans(session, program=program)
    return [plan_to_summary(p) for p in plans]


@router.get("/plans/{cap_id}", response_model=PlanDetail)
async def get_plan(cap_id: str, session: AsyncSession = Depends(get_db)):
    detail = await load_plan_detail(session, cap_id)
    if not detail:
        raise HTTPException(status_code=404, detail=f"Plan {cap_id} not found")
    return detail


@router.post("/plans", response_model=CreatePlanResponse)
async def create_plan_route(body: CreatePlanRequest, session: AsyncSession = Depends(get_db)):
    try:
        detail = await create_plan(session, body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to create plan") from exc
    await session.commit()
    return CreatePlanResponse(
        cap_id=detail.cap_id,
        plan_name=detail.plan_name,
        program=detail.program,
        site=detail.site,
        lob=detail.lob,
        skill=body.skill,
        channel=body.channel,
        planning_period=body.planning_period,
        scenario=body.scenario,
        message=f"Created {detail.cap_id} · {detail.plan_name}",
    )


@router.get("/programs", response_model=list[ProgramOut])
async def list_programs_route(session: AsyncSession = Depends(get_db)):
    return await list_programs(session)
