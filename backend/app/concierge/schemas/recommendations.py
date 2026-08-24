from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class RecommendationOut(BaseModel):
    id: str
    incident_id: str
    action: str
    rationale: str
    reliability_score: float
    reliability_factors: dict
    rank: int
    explanation: str | None = None
    explanation_status: str
    status: str
    cap_id: str | None = None
    program: str | None = None
    domain: str = "operational"
    ui_actions: list[dict] = []
    created_at: datetime


class RecommendationDetailOut(RecommendationOut):
    similar_case_ids: list[str] = []


class RecommendationListOut(BaseModel):
    recommendations: list[RecommendationOut]
    total: int


class FeedbackIn(BaseModel):
    event_type: str = Field(..., description="shown|accepted|rejected|action_taken|resolved|escalated")
    action_taken: str | None = None
    problem_resolved: bool | None = None
    notes: str | None = None


class HistoricalCaseOut(BaseModel):
    id: str
    case_key: str
    incident_type: str
    feature: str
    summary_text: str
    resolution: str
    outcome: str
    similarity_score: float
