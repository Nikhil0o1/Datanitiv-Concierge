from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import (
    agent,
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

    async with AsyncSessionLocal() as session:
        existing = (await session.execute(select(OneviewHierarchy).limit(1))).scalar_one_or_none()
        if not existing:
            await seed_database(session)
        await analyze_portfolio(session)
    yield


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
app.include_router(websocket.router)


@app.get("/")
async def root():
    return {"service": "cap-ability-planning-agent", "docs": "/docs"}
