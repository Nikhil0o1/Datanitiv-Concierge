"""Concierge nudge API schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class NudgeOut(BaseModel):
    id: str
    recommendation_id: str
    incident_id: str
    cap_id: str | None = None
    program: str | None = None
    domain: str
    title: str
    summary: str
    recommendation: str | None = None
    explanation: str | None = None
    reliability_score: float
    reliability_factors: dict
    ui_actions: list[dict] = []
    priority: int
    status: str
    snoozed_until: datetime | None = None
    created_at: datetime


class NudgeListOut(BaseModel):
    nudges: list[NudgeOut]
    total: int


class SnoozeIn(BaseModel):
    minutes: int | None = Field(None, ge=5, le=1440)
