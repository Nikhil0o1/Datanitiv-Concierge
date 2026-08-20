from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas import PlanningCycleOut
from app.services.queries import get_current_cycle

router = APIRouter(prefix="/cycle", tags=["cycle"])


@router.get("/current", response_model=PlanningCycleOut)
async def current_cycle(session: AsyncSession = Depends(get_db)):
    cycle = await get_current_cycle(session)
    if not cycle:
        return PlanningCycleOut(id=0, week_label="Week of Aug 02, 2026")
    return cycle
