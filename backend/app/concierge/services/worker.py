"""Background worker — poll event queue, process pipeline."""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.concierge.models import ConciergeEvent, ConciergeEventQueue
from app.concierge.services.baselines import update_baselines
from app.concierge.services.cases import reembed_cases_if_needed, seed_default_cases
from app.concierge.services.nudges import dismiss_non_wfm_open_nudges
from app.concierge.services.detection import ensure_default_rules, run_detection
from app.concierge.services.context_monitor import maybe_nudge_for_user_context
from app.concierge.services.friction_monitor import run_friction_monitor
from app.concierge.services.incident_pipeline import finalize_incident_with_nudge
from app.concierge.services.incidents import create_or_update_incident
from app.concierge.services.learning import purge_stale_events, run_learning_cycle
from app.concierge.services.metrics import worker_metrics
from app.concierge.services.portfolio_monitor import run_portfolio_monitor
from app.concierge.services.nudge_policy import should_nudge_for_detection_event
from app.concierge.services.sessionization import is_synthetic_session, update_session_for_event
from app.concierge.services.training import ensure_active_model_version
from app.database import AsyncSessionLocal

logger = logging.getLogger("concierge.worker")

_worker_task: asyncio.Task | None = None
_monitor_task: asyncio.Task | None = None
_friction_task: asyncio.Task | None = None
_learning_task: asyncio.Task | None = None
_stop_event = asyncio.Event()


async def start_worker() -> None:
    global _worker_task, _monitor_task, _friction_task, _learning_task
    if _worker_task and not _worker_task.done():
        return
    _stop_event.clear()
    worker_metrics.running = True
    _worker_task = asyncio.create_task(_run_loop())
    _monitor_task = asyncio.create_task(_run_portfolio_monitor_loop())
    _friction_task = asyncio.create_task(_run_friction_monitor_loop())
    _learning_task = asyncio.create_task(_run_learning_loop())
    logger.info("Concierge worker started")


async def stop_worker() -> None:
    global _worker_task, _monitor_task, _friction_task, _learning_task
    _stop_event.set()
    for task in (_worker_task, _monitor_task, _friction_task, _learning_task):
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
    _worker_task = None
    _monitor_task = None
    _friction_task = None
    _learning_task = None
    worker_metrics.running = False
    logger.info("Concierge worker stopped")


async def _run_loop() -> None:
    async with AsyncSessionLocal() as session:
        await ensure_default_rules(session)
        await seed_default_cases(session)
        await dismiss_non_wfm_open_nudges(session)
        await reembed_cases_if_needed(session)
        await ensure_active_model_version(session)
        await session.commit()

    while not _stop_event.is_set():
        try:
            processed = await _process_batch()
            await _update_queue_depth()
            if not processed:
                await asyncio.sleep(1.0)
            else:
                await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Concierge worker loop error")
            await asyncio.sleep(2.0)


async def _run_portfolio_monitor_loop() -> None:
    interval = max(30, settings.concierge_monitor_interval_seconds)
    await asyncio.sleep(2)
    while not _stop_event.is_set():
        try:
            async with AsyncSessionLocal() as session:
                await run_portfolio_monitor(session)
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Portfolio monitor tick failed")
        try:
            await asyncio.wait_for(_stop_event.wait(), timeout=interval)
            break
        except asyncio.TimeoutError:
            continue


async def _run_friction_monitor_loop() -> None:
    interval = max(30, settings.concierge_friction_interval_seconds)
    await asyncio.sleep(10)
    while not _stop_event.is_set():
        try:
            async with AsyncSessionLocal() as session:
                await run_friction_monitor(session)
                await session.commit()
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Friction monitor tick failed")
        try:
            await asyncio.wait_for(_stop_event.wait(), timeout=interval)
            break
        except asyncio.TimeoutError:
            continue


async def _run_learning_loop() -> None:
    interval = max(300, settings.concierge_learning_interval_seconds)
    retention_interval = max(3600, settings.concierge_retention_interval_seconds)
    last_retention = time.monotonic()
    await asyncio.sleep(30)
    while not _stop_event.is_set():
        try:
            async with AsyncSessionLocal() as session:
                await run_learning_cycle(session)
                await session.commit()
            if time.monotonic() - last_retention >= retention_interval:
                async with AsyncSessionLocal() as session:
                    await purge_stale_events(session)
                    await session.commit()
                last_retention = time.monotonic()
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Learning cycle failed")
        try:
            await asyncio.wait_for(_stop_event.wait(), timeout=interval)
            break
        except asyncio.TimeoutError:
            continue


async def _update_queue_depth() -> None:
    async with AsyncSessionLocal() as session:
        depth = (
            await session.execute(
                select(func.count()).select_from(ConciergeEventQueue).where(ConciergeEventQueue.status == "pending")
            )
        ).scalar_one()
        worker_metrics.queue_depth = depth


async def _process_batch(batch_size: int = 10) -> int:
    processed = 0
    async with AsyncSessionLocal() as session:
        rows = await _claim_queue_rows(session, batch_size)
        if not rows:
            return 0

        for queue_row in rows:
            start = time.monotonic()
            try:
                event = (
                    await session.execute(select(ConciergeEvent).where(ConciergeEvent.event_id == queue_row.event_id))
                ).scalar_one_or_none()
                if not event:
                    queue_row.status = "failed"
                    queue_row.error_message = "Event not found"
                    worker_metrics.record_failed()
                    continue

                await update_session_for_event(session, event)
                await update_baselines(session, event)

                if is_synthetic_session(event.session_id):
                    queue_row.status = "completed"
                    queue_row.processed_at = datetime.now(timezone.utc)
                    worker_metrics.record_processed((time.monotonic() - start) * 1000)
                    processed += 1
                    continue

                detections = await run_detection(session, event)

                for detection in detections:
                    worker_metrics.detections_triggered += 1
                    incident, is_new = await create_or_update_incident(session, detection)
                    if not incident:
                        continue
                    if is_new:
                        worker_metrics.incidents_created += 1
                    if await should_nudge_for_detection_event(
                        session,
                        event=event,
                        incident=incident,
                        is_new_incident=is_new,
                    ):
                        await finalize_incident_with_nudge(
                            session,
                            incident,
                            domain="operational",
                            signals=incident.signals,
                            user_session_id=event.session_id,
                        )

                await maybe_nudge_for_user_context(session, event)

                queue_row.status = "completed"
                queue_row.processed_at = datetime.now(timezone.utc)
                worker_metrics.record_processed((time.monotonic() - start) * 1000)
                processed += 1
            except Exception as exc:
                queue_row.attempts += 1
                queue_row.error_message = str(exc)[:500]
                if queue_row.attempts >= 3:
                    queue_row.status = "failed"
                else:
                    queue_row.status = "pending"
                    queue_row.locked_at = None
                worker_metrics.record_failed()
                logger.exception("Failed processing event %s", queue_row.event_id)

        await session.commit()
    return processed


async def _claim_queue_rows(session: AsyncSession, limit: int) -> list[ConciergeEventQueue]:
    now = datetime.now(timezone.utc)
    result = await session.execute(
        text(
            """
            UPDATE concierge_event_queue
            SET status = 'processing', locked_at = :now, attempts = attempts + 1
            WHERE id IN (
                SELECT id FROM concierge_event_queue
                WHERE status = 'pending'
                ORDER BY created_at ASC
                LIMIT :limit
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id
            """
        ),
        {"now": now, "limit": limit},
    )
    ids = [row.id for row in result.fetchall()]
    if not ids:
        return []
    rows = (
        await session.execute(select(ConciergeEventQueue).where(ConciergeEventQueue.id.in_(ids)))
    ).scalars().all()
    return list(rows)
