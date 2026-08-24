"""Pydantic schemas for Concierge telemetry events."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

SENSITIVE_KEYS = frozenset(
    {
        "password",
        "token",
        "api_key",
        "authorization",
        "secret",
        "cookie",
        "credential",
    }
)

ALLOWED_SEVERITIES = frozenset({"debug", "info", "warning", "error", "critical"})
ALLOWED_SOURCES = frozenset({"frontend", "backend", "worker", "system"})


class ConciergeEventIn(BaseModel):
    event_id: UUID | None = None
    schema_version: str = "1.0"
    timestamp: datetime | None = None
    tenant_id: str | None = None
    user_id: str | None = None
    session_id: str | None = None
    event_type: str = Field(..., min_length=1, max_length=64)
    source: str = Field(..., min_length=1, max_length=32)
    service: str | None = None
    endpoint: str | None = None
    status_code: int | None = None
    latency_ms: float | None = None
    error_code: str | None = None
    severity: str = "info"
    metadata: dict[str, Any] = Field(default_factory=dict)
    correlation_id: str | None = None

    @field_validator("source")
    @classmethod
    def validate_source(cls, v: str) -> str:
        if v not in ALLOWED_SOURCES:
            raise ValueError(f"source must be one of {sorted(ALLOWED_SOURCES)}")
        return v

    @field_validator("severity")
    @classmethod
    def validate_severity(cls, v: str) -> str:
        if v not in ALLOWED_SEVERITIES:
            raise ValueError(f"severity must be one of {sorted(ALLOWED_SEVERITIES)}")
        return v

    @field_validator("metadata")
    @classmethod
    def redact_sensitive_metadata(cls, v: dict[str, Any]) -> dict[str, Any]:
        return _redact_dict(v)


class ConciergeEventBatchIn(BaseModel):
    events: list[ConciergeEventIn] = Field(..., min_length=1, max_length=100)


class ConciergeEventIngestResponse(BaseModel):
    accepted: int
    rejected: int
    event_ids: list[str]


def _redact_dict(data: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in data.items():
        if key.lower() in SENSITIVE_KEYS:
            out[key] = "[REDACTED]"
        elif isinstance(value, dict):
            out[key] = _redact_dict(value)
        else:
            out[key] = value
    return out
