"""Fire-and-forget business event emission from WFM routers."""

from __future__ import annotations

from app.concierge.schemas.events import ConciergeEventIn
from app.concierge.services.collector import ingest_events
from app.database import AsyncSessionLocal


async def emit_business_event(
    *,
    event_type: str,
    severity: str = "info",
    session_id: str | None = None,
    endpoint: str | None = None,
    status_code: int | None = None,
    error_code: str | None = None,
    metadata: dict | None = None,
) -> None:
    event = ConciergeEventIn(
        event_type=event_type,
        source="backend",
        service="capability-api",
        endpoint=endpoint,
        status_code=status_code,
        error_code=error_code,
        severity=severity,
        session_id=session_id,
        metadata=metadata or {},
    )
    try:
        async with AsyncSessionLocal() as session:
            await ingest_events(session, [event])
    except Exception:
        pass


def session_id_from_request(request) -> str | None:
    if request is None:
        return None
    return request.headers.get("X-Session-ID") or request.headers.get("x-session-id")
