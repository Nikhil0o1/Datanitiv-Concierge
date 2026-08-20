from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas import PlanningCycleOut
from app.services.demo_store import DEMO_PLANNING_CYCLE, get_json_setting


async def get_current_cycle(session: AsyncSession) -> PlanningCycleOut | None:
    data = await get_json_setting(session, DEMO_PLANNING_CYCLE, None)
    if not data:
        return None
    return PlanningCycleOut(id=int(data.get("id", 1)), week_label=data.get("week_label", ""))
