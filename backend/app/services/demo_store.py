import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppSetting

DEMO_ACTION_PACKAGES = "demo.action_packages"
DEMO_TIME_LEDGER = "demo.time_ledger"
DEMO_AGENT_MEMORIES = "demo.agent_memories"
DEMO_PLANNING_CYCLE = "demo.planning_cycle"
DEMO_PLAN_META = "demo.plan_meta"


async def get_json_setting(session: AsyncSession, key: str, default: Any) -> Any:
    result = await session.execute(select(AppSetting).where(AppSetting.option_key == key))
    row = result.scalar_one_or_none()
    if not row:
        return default
    try:
        return json.loads(row.option_value)
    except json.JSONDecodeError:
        return default


async def set_json_setting(session: AsyncSession, key: str, value: Any) -> None:
    payload = json.dumps(value)
    result = await session.execute(select(AppSetting).where(AppSetting.option_key == key))
    row = result.scalar_one_or_none()
    if row:
        row.option_value = payload
        row.value_type = "json"
    else:
        session.add(AppSetting(option_key=key, option_value=payload, value_type="json"))
