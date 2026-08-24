"""Event collector — validate, normalize, persist, enqueue."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.concierge.models import ConciergeEvent, ConciergeEventQueue
from app.concierge.schemas.events import ConciergeEventIn


async def ingest_events(session: AsyncSession, events: list[ConciergeEventIn]) -> tuple[list[uuid.UUID], int]:
    accepted: list[uuid.UUID] = []
    rejected = 0
    now = datetime.now(timezone.utc)

    for event_in in events:
        try:
            event_id = event_in.event_id or uuid.uuid4()
            ts = event_in.timestamp or now
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)

            row = ConciergeEvent(
                event_id=event_id,
                schema_version=event_in.schema_version,
                timestamp=ts,
                tenant_id=event_in.tenant_id or "default",
                user_id=event_in.user_id,
                session_id=event_in.session_id,
                event_type=event_in.event_type,
                source=event_in.source,
                service=event_in.service,
                endpoint=event_in.endpoint,
                status_code=event_in.status_code,
                latency_ms=event_in.latency_ms,
                error_code=event_in.error_code,
                severity=event_in.severity,
                metadata_=event_in.metadata,
                correlation_id=event_in.correlation_id,
            )
            session.add(row)
            session.add(ConciergeEventQueue(event_id=event_id, status="pending"))
            accepted.append(event_id)
        except Exception:
            rejected += 1

    if accepted:
        await session.commit()
    return accepted, rejected


async def emit_backend_event(
    session: AsyncSession,
    *,
    event_type: str,
    service: str | None = None,
    endpoint: str | None = None,
    status_code: int | None = None,
    latency_ms: float | None = None,
    error_code: str | None = None,
    severity: str = "info",
    metadata: dict | None = None,
    session_id: str | None = None,
    correlation_id: str | None = None,
) -> uuid.UUID | None:
    if not session.in_transaction():
        pass
    event = ConciergeEventIn(
        event_type=event_type,
        source="backend",
        service=service,
        endpoint=endpoint,
        status_code=status_code,
        latency_ms=latency_ms,
        error_code=error_code,
        severity=severity,
        metadata=metadata or {},
        session_id=session_id,
        correlation_id=correlation_id,
    )
    ids, _ = await ingest_events(session, [event])
    return ids[0] if ids else None
