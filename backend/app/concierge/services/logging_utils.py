"""Structured logging helper for Concierge."""

from __future__ import annotations

import json
import logging
import sys
from typing import Any

from app.config import settings


def setup_concierge_logging() -> None:
    root = logging.getLogger("concierge")
    if root.handlers:
        return
    handler = logging.StreamHandler(sys.stdout)
    if settings.concierge_structured_logs:
        handler.setFormatter(_JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s"))
    root.addHandler(handler)
    root.setLevel(getattr(logging, settings.concierge_log_level.upper(), logging.INFO))
    root.propagate = False


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if hasattr(record, "extra_fields") and isinstance(record.extra_fields, dict):
            payload.update(record.extra_fields)
        return json.dumps(payload, default=str)


def log_event(logger: logging.Logger, level: int, message: str, **fields: Any) -> None:
    record = logger.makeRecord(logger.name, level, "", 0, message, (), None)
    record.extra_fields = fields  # type: ignore[attr-defined]
    logger.handle(record)
