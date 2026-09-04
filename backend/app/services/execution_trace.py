"""In-memory trace of the exact input sent to, and raw output received from, the Vera agent.

Not persisted — holds the last MAX_TRACES calls in the running process, newest first.
"""

from __future__ import annotations

import itertools
from collections import deque
from datetime import datetime, timezone
from typing import Any

MAX_TRACES = 30

_traces: deque[dict[str, Any]] = deque(maxlen=MAX_TRACES)
_id_counter = itertools.count(1)


def record_trace(
    *,
    endpoint: str,
    model: str,
    max_tokens: int,
    system: str,
    messages: list[dict[str, str]],
    raw_response: str,
) -> None:
    """Store one call's exact request payload and exact raw model output."""
    _traces.appendleft(
        {
            "id": next(_id_counter),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "endpoint": endpoint,
            "input": {
                "model": model,
                "max_tokens": max_tokens,
                "system": system,
                "messages": messages,
            },
            "raw_response": raw_response,
        }
    )


def list_traces() -> list[dict[str, Any]]:
    return list(_traces)


def get_trace(trace_id: int) -> dict[str, Any] | None:
    for trace in _traces:
        if trace["id"] == trace_id:
            return trace
    return None
