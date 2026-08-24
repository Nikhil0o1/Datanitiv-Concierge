"""Titles, priorities, and UI actions for all Concierge incident types."""

from __future__ import annotations

from typing import Any

from app.concierge.models import ConciergeIncident
from app.concierge.services.wfm_actions import (
    ui_actions_for_wfm_incident,
    wfm_incident_title,
    wfm_priority,
)

WFM_TYPES = frozenset(
    {
        "PLAN_SUSTAINED_UNDER",
        "PLAN_CRITICAL_SHORT",
        "PLAN_DECISION_REQUIRED",
        "SHRINKAGE_DRIFT",
        "ROSTER_GAP",
        "FORWARD_OU_RISK",
    }
)

OPERATIONAL_TITLES = {
    "SHRINKAGE_SUBMISSION_FAILURE": "Shrinkage submission failing",
    "QUEUE_EXECUTE_FAILURE": "Queue execute failing",
    "AGENT_CHAT_FAILURE": "Agent connection issue",
    "API_FAILURE": "Repeated API failures",
    "ERROR_RATE_SPIKE": "Elevated error rate",
    "USER_FRICTION": "You may be stuck — Concierge noticed",
    "SESSION_ABANDONED": "Workflow abandoned after errors",
    "ROSTER_SUBMISSION_FAILURE": "Roster mapping failing",
}


def ui_actions_for_incident(incident_type: str, signals: dict[str, Any]) -> list[dict]:
    if incident_type in WFM_TYPES:
        return ui_actions_for_wfm_incident(incident_type, signals)

    cap_id = signals.get("cap_id")
    actions: list[dict] = []

    if incident_type == "SHRINKAGE_SUBMISSION_FAILURE" and cap_id:
        actions.extend(
            [
                {"type": "open_plan", "params": {"cap_id": cap_id}},
                {"type": "open_tab", "params": {"tab": "shr"}},
            ]
        )
    elif incident_type in ("ROSTER_SUBMISSION_FAILURE",) and cap_id:
        actions.extend(
            [
                {"type": "open_plan", "params": {"cap_id": cap_id}},
                {"type": "open_tab", "params": {"tab": "nh"}},
            ]
        )
    elif incident_type == "QUEUE_EXECUTE_FAILURE":
        actions.append({"type": "view", "params": {"view": "queue"}})
    elif cap_id:
        actions.append({"type": "open_plan", "params": {"cap_id": cap_id}})

    return actions


def incident_title(incident: ConciergeIncident) -> str:
    signals = incident.signals or {}
    if incident.incident_type in WFM_TYPES:
        return wfm_incident_title(incident.incident_type, signals)
    base = OPERATIONAL_TITLES.get(incident.incident_type, "Platform issue detected")
    cap_id = signals.get("cap_id") or incident.cap_id
    if cap_id:
        return f"{base} · {cap_id}"
    return base


def incident_priority(incident: ConciergeIncident) -> int:
    signals = incident.signals or {}
    if incident.incident_type in WFM_TYPES:
        return wfm_priority(incident.incident_type, signals)
    if incident.incident_type == "USER_FRICTION":
        return 85
    if incident.incident_type in ("SHRINKAGE_SUBMISSION_FAILURE", "PLAN_CRITICAL_SHORT"):
        return 80
    if incident.severity == "HIGH":
        return 70
    return 55
