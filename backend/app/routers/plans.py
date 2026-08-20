from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas import PlanDetail, PlanSummary, ProgramOut
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


@router.get("/programs", response_model=list[ProgramOut])
async def list_programs_route(session: AsyncSession = Depends(get_db)):
    return await list_programs(session)
