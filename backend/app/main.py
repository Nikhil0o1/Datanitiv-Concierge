from contextlib import asynccontextmanager
import asyncio

from fastapi import APIRouter, Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.concierge.middleware.telemetry import ConciergeTelemetryMiddleware
from app.concierge.otel import setup_opentelemetry
from app.concierge.router import router as concierge_router
from app.concierge.services.logging_utils import setup_concierge_logging
from app.concierge.services.metrics import worker_metrics
from app.concierge.services.worker import start_worker, stop_worker
from app.database import get_db
from app.routers import (
    agent,
    cost,
    cycle,
    health,
    ledger,
    plan_actions,
    plans,
    portfolio,
    queue,
    triage,
    voice,
    websocket,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import OneviewHierarchy
    from app.services.portfolio_analysis import analyze_portfolio
    from app.services.seed import seed_database

    setup_concierge_logging()

    async with AsyncSessionLocal() as session:
        existing = (await session.execute(select(OneviewHierarchy).limit(1))).scalar_one_or_none()
        if not existing:
            await seed_database(session)
        await analyze_portfolio(session)

    if settings.concierge_enabled and settings.concierge_worker_enabled:
        await start_worker()

    if settings.elevenlabs_api_key:
        from app.services.voice_fillers import warm_filler_cache

        asyncio.create_task(warm_filler_cache())

    from app.services.usage_tracker import ensure_usage_table

    await ensure_usage_table()

    yield

    if settings.concierge_enabled and settings.concierge_worker_enabled:
        await stop_worker()


app = FastAPI(
    title="Datanitiv CAP-ABILITY Planning Agent",
    description="Backend API for capacity planning portfolio triage and agent workflows",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if settings.concierge_enabled:
    app.add_middleware(ConciergeTelemetryMiddleware)

app.include_router(health.router, prefix="/api")
app.include_router(cycle.router, prefix="/api")
app.include_router(plans.router, prefix="/api")
app.include_router(triage.router, prefix="/api")
app.include_router(portfolio.router, prefix="/api")
app.include_router(queue.router, prefix="/api")
app.include_router(ledger.router, prefix="/api")
app.include_router(plan_actions.router, prefix="/api")
app.include_router(voice.router, prefix="/api")
app.include_router(agent.router, prefix="/api")
app.include_router(cost.router, prefix="/api")
app.include_router(websocket.router)

if settings.concierge_enabled:
    app.include_router(concierge_router, prefix="/api")

setup_opentelemetry(app)


@app.get("/")
async def root():
    return {"service": "cap-ability-planning-agent", "docs": "/docs", "concierge_enabled": settings.concierge_enabled}
