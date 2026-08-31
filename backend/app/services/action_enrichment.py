"""Ensure Vera UI actions execute when the model narrates intent but omits structured actions."""

from __future__ import annotations

import re
from typing import Any

CAP_ID_RE = re.compile(r"\b(CAP\d{5})\b", re.I)
AFFIRM_RE = re.compile(
    r"^(?:yes|yeah|yep|yup|sure|ok|okay|go ahead|please(?: do)?|do it|open it|"
    r"absolutely|correct|right|sounds good|that one|please open|go for it|"
    r"let'?s do it|let'?s go)\b",
    re.I,
)
OPEN_NARRATIVE_RE = re.compile(
    r"\b(opening|pulling up|taking you to|bringing up|loading|switching to|navigating to)\b",
    re.I,
)

TAB_ALIASES: dict[str, str] = {
    "overview": "ov",
    "ov": "ov",
    "forecast": "fw",
    "fw": "fw",
    "headcount": "hc",
    "hc": "hc",
    "new hire": "nh",
    "newhire": "nh",
    "nh": "nh",
    "shrinkage": "shr",
    "shrink": "shr",
    "shr": "shr",
    "attrition": "att",
    "att": "att",
    "recommend": "rec",
    "rec": "rec",
    "recommendation": "rec",
    "execute": "exe",
    "exe": "exe",
}

OFFER_OPEN_PLAN_RE = re.compile(
    r"\b(want me to open|shall i open|should i open|open (?:that|it|up)|pull (?:that|it) up|"
    r"take you (?:there|to it)|bring (?:that|it) up)\b",
    re.I,
)
OFFER_OPEN_TAB_RE = re.compile(
    r"\b(want me to open|shall i open|should i open|open (?:the |that )?(\w+(?:\s+\w+)?) tab|"
    r"pull up (?:the )?(\w+(?:\s+\w+)?)|switch to (?:the )?(\w+(?:\s+\w+)?))\b",
    re.I,
)


def _last_assistant_text(history: list[dict[str, str]] | None) -> str:
    for turn in reversed(history or []):
        if turn.get("role") == "assistant":
            return (turn.get("content") or "").strip()
    return ""


def _normalize_tab(raw: str | None) -> str | None:
    if not raw:
        return None
    key = raw.strip().lower()
    if key in TAB_ALIASES:
        return TAB_ALIASES[key]
    for alias, code in TAB_ALIASES.items():
        if alias in key or key in alias:
            return code
    return None


def _extract_cap_ids(*texts: str) -> list[str]:
    seen: list[str] = []
    for text in texts:
        for match in CAP_ID_RE.finditer(text or ""):
            cap = match.group(1).upper()
            if cap not in seen:
                seen.append(cap)
    return seen


def _extract_tab_from_text(text: str) -> str | None:
    lower = (text or "").lower()
    if "shrinkage" in lower or "shrink tab" in lower:
        return "shr"
    if "overview" in lower:
        return "ov"
    if "headcount" in lower:
        return "hc"
    if "new hire" in lower or "newhire" in lower:
        return "nh"
    if "attrition" in lower:
        return "att"
    if "recommend" in lower:
        return "rec"
    if "forecast" in lower:
        return "fw"
    if "execute" in lower:
        return "exe"
    for match in re.finditer(r"\b([a-z]{2,3})\b tab", lower):
        tab = _normalize_tab(match.group(1))
        if tab:
            return tab
    return None


def _normalize_action(action: Any) -> dict[str, Any] | None:
    if not isinstance(action, dict):
        return None
    raw_type = (action.get("type") or "").strip().lower().replace(" ", "_").replace("-", "_")
    params = dict(action.get("params") or {})

    type_map = {
        "openplan": "open_plan",
        "open_plan": "open_plan",
        "opentab": "open_tab",
        "open_tab": "open_tab",
        "setfilter": "set_filter",
        "set_filter": "set_filter",
        "set_shrinkage_weeks": "set_shrinkage_weeks",
        "map_roster": "map_roster",
        "execute_queue": "execute_queue",
        "view": "view",
        "mark_tabs": "mark_tabs",
        "open_create_plan": "open_create_plan",
        "opencreateplan": "open_create_plan",
        "set_create_plan_field": "set_create_plan_field",
        "setcreateplanfield": "set_create_plan_field",
        "submit_create_plan": "submit_create_plan",
        "submitcreateplan": "submit_create_plan",
    }
    action_type = type_map.get(raw_type)
    if not action_type:
        return None

    if action_type == "open_plan":
        cap = params.get("cap_id") or params.get("capId") or params.get("cap")
        if cap:
            params["cap_id"] = str(cap).upper()
        else:
            return None

    if action_type == "open_tab":
        tab = _normalize_tab(params.get("tab") or params.get("name") or params.get("tab_id"))
        if tab:
            params["tab"] = tab
        else:
            return None

    if action_type == "set_filter":
        program = params.get("program")
        if program:
            params["program"] = str(program)

    if action_type == "set_create_plan_field":
        field = params.get("field")
        value = params.get("value")
        if field is None or value is None:
            return None
        params["field"] = str(field)
        params["value"] = str(value)

    if action_type in ("open_create_plan", "submit_create_plan"):
        params = {}

    return {"type": action_type, "params": params}


def _dedupe_actions(actions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for act in actions:
        key = f"{act.get('type')}|{act.get('params')}"
        if key in seen:
            continue
        seen.add(key)
        out.append(act)
    return out


def _infer_from_offer(assistant_text: str, *, active_cap_id: str | None) -> list[dict[str, Any]]:
    text = assistant_text or ""
    caps = _extract_cap_ids(text)
    cap_id = caps[0] if caps else (active_cap_id.upper() if active_cap_id else None)
    inferred: list[dict[str, Any]] = []

    if OFFER_OPEN_PLAN_RE.search(text) and cap_id:
        inferred.append({"type": "open_plan", "params": {"cap_id": cap_id}})

    tab = _extract_tab_from_text(text)
    if tab and (OFFER_OPEN_TAB_RE.search(text) or "tab" in text.lower()):
        if cap_id and OFFER_OPEN_PLAN_RE.search(text):
            inferred.append({"type": "open_plan", "params": {"cap_id": cap_id}})
        inferred.append({"type": "open_tab", "params": {"tab": tab}})

    return inferred


def _infer_from_narration(reply: str, *, active_cap_id: str | None) -> list[dict[str, Any]]:
    if not OPEN_NARRATIVE_RE.search(reply or ""):
        return []

    caps = _extract_cap_ids(reply)
    cap_id = caps[0] if caps else (active_cap_id.upper() if active_cap_id else None)
    inferred: list[dict[str, Any]] = []

    lower = (reply or "").lower()
    if cap_id and ("cap" in lower or "plan" in lower or cap_id.lower() in lower):
        inferred.append({"type": "open_plan", "params": {"cap_id": cap_id}})

    tab = _extract_tab_from_text(reply)
    if tab:
        if cap_id and not any(a.get("type") == "open_plan" for a in inferred):
            # Tab switch while already in a plan — active cap is enough.
            pass
        inferred.append({"type": "open_tab", "params": {"tab": tab}})

    return inferred


def enrich_actions(
    actions: list[Any] | None,
    *,
    reply: str,
    user_message: str,
    history: list[dict[str, str]] | None,
    active_cap_id: str | None = None,
) -> list[dict[str, Any]]:
    """Normalize model actions and infer missing ones from confirmations or narration."""
    normalized: list[dict[str, Any]] = []
    for raw in actions or []:
        act = _normalize_action(raw)
        if act:
            normalized.append(act)

    if normalized:
        return _dedupe_actions(normalized)

    user = (user_message or "").strip()
    assistant_prior = _last_assistant_text(history)
    reply_text = (reply or "").strip()

    if AFFIRM_RE.search(user):
        normalized.extend(_infer_from_offer(assistant_prior, active_cap_id=active_cap_id))

    if not normalized:
        normalized.extend(_infer_from_narration(reply_text, active_cap_id=active_cap_id))

    if not normalized and AFFIRM_RE.search(user):
        # Last resort: user confirmed and prior message named a cap — open it.
        caps = _extract_cap_ids(assistant_prior, reply_text)
        if caps:
            normalized.append({"type": "open_plan", "params": {"cap_id": caps[0]}})

    return _dedupe_actions(normalized)
