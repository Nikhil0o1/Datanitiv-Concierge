"""In-memory worker metrics for Concierge self-observability."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class WorkerMetrics:
    running: bool = False
    last_heartbeat: datetime | None = None
    events_processed: int = 0
    events_failed: int = 0
    queue_depth: int = 0
    processing_latency_ms: float = 0.0
    incidents_created: int = 0
    recommendations_created: int = 0
    detections_triggered: int = 0
    llm_calls: int = 0
    llm_failures: int = 0
    _window_start: float = field(default_factory=time.monotonic)
    _window_count: int = 0

    def record_processed(self, latency_ms: float) -> None:
        self.events_processed += 1
        self._window_count += 1
        self.processing_latency_ms = latency_ms
        self.last_heartbeat = datetime.now(timezone.utc)

    def record_failed(self) -> None:
        self.events_failed += 1
        self.last_heartbeat = datetime.now(timezone.utc)

    def events_per_sec(self) -> float:
        elapsed = max(time.monotonic() - self._window_start, 0.001)
        rate = self._window_count / elapsed
        if elapsed > 60:
            self._window_start = time.monotonic()
            self._window_count = 0
        return round(rate, 2)

    def to_dict(self) -> dict:
        return {
            "running": self.running,
            "last_heartbeat": self.last_heartbeat.isoformat() if self.last_heartbeat else None,
            "events_processed": self.events_processed,
            "events_failed": self.events_failed,
            "queue_depth": self.queue_depth,
            "events_per_sec": self.events_per_sec(),
            "processing_latency_ms": self.processing_latency_ms,
            "incidents_created": self.incidents_created,
            "recommendations_created": self.recommendations_created,
            "detections_triggered": self.detections_triggered,
            "llm_calls": self.llm_calls,
            "llm_failures": self.llm_failures,
        }


worker_metrics = WorkerMetrics()
