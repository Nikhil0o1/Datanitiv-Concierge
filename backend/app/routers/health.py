from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.concierge.services.metrics import worker_metrics
from app.database import get_db
from app.schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(status="ok")


@router.get("/health/ready")
async def health_ready(session: AsyncSession = Depends(get_db)):
    checks = {"database": False, "concierge_worker": worker_metrics.running}
    try:
        await session.execute(text("SELECT 1"))
        checks["database"] = True
    except Exception as exc:
        return {"status": "not_ready", "checks": checks, "error": str(exc)}

    if checks["database"] and checks["concierge_worker"]:
        return {"status": "ready", "checks": checks}
    return {"status": "degraded", "checks": checks}
