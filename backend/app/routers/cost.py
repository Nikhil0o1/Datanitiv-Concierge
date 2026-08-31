"""Cost tracking API — Anthropic Claude usage analytics."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.usage_tracker import get_analytics, get_cost_summary

router = APIRouter(prefix="/cost", tags=["cost"])


@router.get("/analytics")
async def cost_analytics(
    range: str = Query("24h", pattern="^(1h|6h|24h|7d|30d|90d)$"),
    group_by: str = Query("none", pattern="^(none|model|provider)$"),
    session: AsyncSession = Depends(get_db),
):
    return await get_analytics(session, range_key=range, group_by=group_by)


@router.get("/summary")
async def cost_summary(session: AsyncSession = Depends(get_db)):
    return await get_cost_summary(session)
