from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas import LedgerEntryOut, LedgerResponse, MemoryOut
from app.services.demo_store import DEMO_AGENT_MEMORIES, DEMO_TIME_LEDGER, get_json_setting

router = APIRouter(tags=["ledger", "memories"])

BASELINE_MINUTES = 1440


@router.get("/ledger", response_model=LedgerResponse)
async def get_ledger(session: AsyncSession = Depends(get_db)):
    entries = await get_json_setting(session, DEMO_TIME_LEDGER, [])
    total = sum(int(e["minutes"]) for e in entries)
    return LedgerResponse(
        entries=[LedgerEntryOut(**e) for e in entries],
        total_minutes=total,
        remaining_minutes=max(0, BASELINE_MINUTES - total),
    )


@router.get("/memories", response_model=list[MemoryOut])
async def get_memories(session: AsyncSession = Depends(get_db)):
    memories = await get_json_setting(session, DEMO_AGENT_MEMORIES, [])
    return [MemoryOut(**m) for m in memories]
