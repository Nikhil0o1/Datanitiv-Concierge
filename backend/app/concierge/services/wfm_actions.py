"""Map WFM incidents to UI actions for proactive Concierge guidance."""

from __future__ import annotations

from typing import Any


def ui_actions_for_wfm_incident(incident_type: str, signals: dict[str, Any]) -> list[dict]:
    cap_id = signals.get("cap_id")
    if not cap_id:
        return []

    actions: list[dict] = []

    if incident_type in ("PLAN_SUSTAINED_UNDER", "PLAN_DECISION_REQUIRED", "PLAN_CRITICAL_SHORT"):
        actions.append({"type": "open_plan", "params": {"cap_id": cap_id}})
        if float(signals.get("sustained", 0)) < -1:
            actions.append({"type": "open_tab", "params": {"tab": "shr"}})
        actions.append({"type": "open_tab", "params": {"tab": "rec"}})

    elif incident_type == "SHRINKAGE_DRIFT":
        actions.extend(
            [
                {"type": "open_plan", "params": {"cap_id": cap_id}},
                {"type": "open_tab", "params": {"tab": "shr"}},
            ]
        )

    elif incident_type == "ROSTER_GAP":
        actions.extend(
            [
                {"type": "open_plan", "params": {"cap_id": cap_id}},
                {"type": "open_tab", "params": {"tab": "nh"}},
                {"type": "map_roster", "params": {"cap_id": cap_id}},
            ]
        )

    elif incident_type == "FORWARD_OU_RISK":
        actions.extend(
            [
                {"type": "open_plan", "params": {"cap_id": cap_id}},
                {"type": "open_tab", "params": {"tab": "ov"}},
            ]
        )

    return actions


def wfm_incident_title(incident_type: str, signals: dict[str, Any]) -> str:
    cap_id = signals.get("cap_id", "Plan")
    plan_name = signals.get("plan_name", cap_id)
    mapping = {
        "PLAN_SUSTAINED_UNDER": f"Sustained understaffing · {plan_name}",
        "PLAN_CRITICAL_SHORT": f"Critical FTE shortfall · {plan_name}",
        "PLAN_DECISION_REQUIRED": f"Decision required · {plan_name}",
        "SHRINKAGE_DRIFT": f"Shrinkage above plan · {plan_name}",
        "ROSTER_GAP": f"Roster mapping gap · {plan_name}",
        "FORWARD_OU_RISK": f"Forward OU risk · {plan_name}",
    }
    return mapping.get(incident_type, f"Planning issue · {plan_name}")


def wfm_priority(incident_type: str, signals: dict[str, Any]) -> int:
    sustained = float(signals.get("sustained", 0))
    if incident_type == "PLAN_CRITICAL_SHORT" or sustained <= -10:
        return 90
    if incident_type in ("PLAN_SUSTAINED_UNDER", "PLAN_DECISION_REQUIRED"):
        return 75
    if incident_type == "ROSTER_GAP":
        return 70
    if incident_type == "SHRINKAGE_DRIFT":
        return 60
    return 50
