from fastapi import APIRouter

from sqlalchemy import func, select

from app.config import settings
from app.concierge.models import ConciergeEventQueue
from app.concierge.services.metrics import worker_metrics
from app.concierge.services.nudges import list_pending_nudges
from app.database import AsyncSessionLocal

router = APIRouter()


@router.get("/status")
async def concierge_status():
    async with AsyncSessionLocal() as session:
        depth = (
            await session.execute(
                select(func.count()).select_from(ConciergeEventQueue).where(ConciergeEventQueue.status == "pending")
            )
        ).scalar_one()
        worker_metrics.queue_depth = depth
        pending = await list_pending_nudges(session, limit=100)

    return {
        "concierge": "active",
        "worker": worker_metrics.to_dict(),
        "queue_depth": worker_metrics.queue_depth,
        "pending_nudges": len(pending),
    }


@router.get("/config")
async def concierge_config():
    return {
        "nudge_auto_guide": settings.concierge_nudge_auto_guide,
        "poll_interval_seconds": settings.concierge_nudge_poll_hint_seconds,
        "monitor_interval_seconds": settings.concierge_monitor_interval_seconds,
        "llm_enabled": settings.concierge_llm_enabled,
    }


@router.get("/metrics")
async def concierge_metrics():
    return worker_metrics.to_dict()
