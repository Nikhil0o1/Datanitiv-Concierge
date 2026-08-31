"""Helpers for streaming Vera agent responses — partial JSON reply extraction."""

from __future__ import annotations

import json
import re


def extract_partial_reply(buffer: str, *, voice: bool = False) -> str | None:
    """Extract speakable text from a partial Claude response."""
    if voice:
        spoken = buffer.split("---ACTIONS---", 1)[0]
        text = spoken.strip()
        return text if text else None

    match = re.search(r'"reply"\s*:\s*"', buffer)
    if not match:
        return None

    i = match.end()
    chars: list[str] = []
    while i < len(buffer):
        ch = buffer[i]
        if ch == "\\":
            if i + 1 >= len(buffer):
                break
            nxt = buffer[i + 1]
            escape_map = {"n": "\n", "r": "\r", "t": "\t", '"': '"', "\\": "\\"}
            chars.append(escape_map.get(nxt, nxt))
            i += 2
            continue
        if ch == '"':
            break
        chars.append(ch)
        i += 1

    text = "".join(chars)
    return text if text else None


def sse_event(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _parse_voice_actions(raw: str) -> tuple[str, dict]:
    """Split spoken text from actions JSON for voice streams."""
    actions_payload: dict = {"intent": "other", "actions": []}
    spoken = raw.strip()

    if "---ACTIONS---" in raw:
        spoken, _, actions_part = raw.partition("---ACTIONS---")
        spoken = spoken.strip()
        actions_part = actions_part.strip()
    else:
        json_blob = _extract_json_object(raw)
        if json_blob and '"actions"' in json_blob:
            actions_part = json_blob
            idx = raw.rfind(json_blob)
            spoken = raw[:idx].strip() if idx >= 0 else spoken
        else:
            actions_part = ""

    if actions_part:
        for candidate in (actions_part, _extract_json_object(actions_part)):
            if not candidate:
                continue
            try:
                data = json.loads(candidate)
                if isinstance(data, dict):
                    actions_payload = data
                    break
            except json.JSONDecodeError:
                continue
    return spoken, actions_payload


def parse_stream_response(raw: str, *, voice: bool = False) -> dict:
    """Parse a completed stream buffer into reply + actions."""
    if voice:
        spoken, actions_payload = _parse_voice_actions(raw)
        return {
            "reply": spoken,
            "intent": actions_payload.get("intent"),
            "actions": actions_payload.get("actions") if isinstance(actions_payload.get("actions"), list) else [],
        }

    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    for candidate in (cleaned, _extract_json_object(cleaned)):
        if not candidate:
            continue
        try:
            data = json.loads(candidate)
            if isinstance(data, dict) and data.get("reply"):
                return {
                    "reply": str(data.get("reply") or ""),
                    "intent": data.get("intent"),
                    "actions": data.get("actions") if isinstance(data.get("actions"), list) else [],
                }
        except json.JSONDecodeError:
            continue

    if cleaned:
        return {"reply": cleaned, "intent": "other", "actions": []}
    return {"reply": "", "intent": "other", "actions": []}


def _extract_json_object(text: str) -> str | None:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    return match.group(0) if match else None
