"""Concierge API routers."""

from fastapi import APIRouter

from app.concierge.routers.events import router as events_router
from app.concierge.routers.historical_cases import router as cases_router
from app.concierge.routers.incidents import router as incidents_router
from app.concierge.routers.nudges import router as nudges_router
from app.concierge.routers.recommendations import router as recommendations_router
from app.concierge.routers.status import router as status_router

router = APIRouter(prefix="/concierge", tags=["concierge"])
router.include_router(events_router)
router.include_router(status_router)
router.include_router(incidents_router)
router.include_router(recommendations_router)
router.include_router(nudges_router)
router.include_router(cases_router)
