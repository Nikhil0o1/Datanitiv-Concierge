"""FastAPI middleware — emit api_request telemetry."""

from __future__ import annotations

import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.concierge.schemas.events import ConciergeEventIn
from app.concierge.services.collector import ingest_events
from app.database import AsyncSessionLocal


class ConciergeTelemetryMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        if request.url.path.startswith("/api/concierge/events"):
            return await call_next(request)

        correlation_id = request.headers.get("X-Correlation-ID") or str(uuid.uuid4())
        request.state.correlation_id = correlation_id
        start = time.perf_counter()
        response = await call_next(request)
        latency_ms = (time.perf_counter() - start) * 1000
        if request.url.path.startswith("/api/"):
            await self._emit(request, response.status_code, latency_ms, correlation_id)
        response.headers["X-Correlation-ID"] = correlation_id
        return response

    async def _emit(self, request: Request, status_code: int, latency_ms: float, correlation_id: str) -> None:
        severity = "info"
        event_type = "api_request"
        error_code = None
        if status_code >= 500:
            severity = "error"
            event_type = "api_error"
            error_code = f"HTTP_{status_code}"
        elif status_code >= 400:
            severity = "warning"
            event_type = "api_error"
            error_code = f"HTTP_{status_code}"

        session_id = request.headers.get("X-Session-ID")
        event = ConciergeEventIn(
            event_type=event_type,
            source="backend",
            service="capability-api",
            endpoint=request.url.path,
            status_code=status_code,
            latency_ms=round(latency_ms, 2),
            error_code=error_code,
            severity=severity,
            session_id=session_id,
            correlation_id=correlation_id,
            metadata={"method": request.method},
        )
        try:
            async with AsyncSessionLocal() as session:
                await ingest_events(session, [event])
        except Exception:
            pass
