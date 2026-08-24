"""Pytest fixtures for Concierge tests."""

import os
from contextlib import asynccontextmanager

import pytest
from httpx import ASGITransport, AsyncClient

os.environ["CONCIERGE_WORKER_ENABLED"] = "false"
os.environ["CONCIERGE_LLM_ENABLED"] = "false"

from app.config import settings  # noqa: E402

settings.concierge_worker_enabled = False
settings.concierge_llm_enabled = False

from app.main import app  # noqa: E402


@asynccontextmanager
async def _test_lifespan(_app):
    yield


app.router.lifespan_context = _test_lifespan


@pytest.fixture(autouse=True)
async def _reset_engine_pool():
    yield
    from app.database import engine

    await engine.dispose()


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def db_session():
    from app.database import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        yield session
        await session.rollback()
