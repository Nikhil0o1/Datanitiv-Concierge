import json
import logging
import re

from anthropic import AsyncAnthropic
from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.schemas import AgentChatRequest, AgentChatResponse
from app.services.agent_context import build_agent_context
from app.services.agent_harness import SYSTEM_PROMPT, build_claude_messages

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/agent", tags=["agent"])


@router.post("/chat", response_model=AgentChatResponse)
async def agent_chat(body: AgentChatRequest, session: AsyncSession = Depends(get_db)):
    if not settings.anthropic_api_key:
        raise HTTPException(status_code=503, detail="Anthropic API key not configured")

    try:
        ui = body.ui_state or {}
        context = await build_agent_context(
            session,
            active_cap_id=body.context_cap_id,
            active_view=ui.get("view"),
            active_filter=ui.get("filter"),
            active_tab=ui.get("active_tab"),
        )

        history = [{"role": m.role, "content": m.content} for m in (body.history or [])]
        messages = build_claude_messages(
            portfolio_context=context,
            user_message=body.message,
            ui_state=ui,
            history=history,
            source=body.source,
        )

        logger.info(
            "agent_chat claude model=%s user=%r history_len=%d",
            settings.anthropic_model,
            body.message[:80],
            len(history),
        )
        from app.concierge.services.business_events import emit_business_event

        await emit_business_event(
            event_type="agent.chat.started",
            metadata={"source": body.source, "cap_id": body.context_cap_id},
        )
        client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        try:
            response = await client.messages.create(
                model=settings.anthropic_model,
                max_tokens=2048,
                temperature=0.75,
                system=SYSTEM_PROMPT,
                messages=messages,
            )
        except Exception as exc:
            logger.exception("Claude API call failed")
            raise HTTPException(status_code=502, detail=f"Claude API error: {exc}") from exc

        raw = response.content[0].text if response.content else ""
        parsed = _parse_agent_json(raw)
        await emit_business_event(
            event_type="agent.chat.completed",
            metadata={"intent": parsed.get("intent"), "action_count": len(parsed.get("actions") or [])},
        )
        return _to_response(parsed)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("agent_chat failed")
        from app.concierge.services.business_events import emit_business_event

        await emit_business_event(
            event_type="agent.chat.failed",
            severity="error",
            error_code="AGENT_CHAT_ERROR",
            metadata={"error": str(exc)[:200]},
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/status")
async def agent_status():
    return {
        "anthropic_configured": bool(settings.anthropic_api_key),
        "model": settings.anthropic_model,
        "elevenlabs_configured": bool(settings.elevenlabs_api_key),
    }


def _to_response(parsed: dict) -> AgentChatResponse:
    actions = parsed.get("actions") if isinstance(parsed.get("actions"), list) else []
    actions = [a for a in actions if isinstance(a, dict)]
    intent = parsed.get("intent")
    try:
        return AgentChatResponse(
            reply=str(parsed.get("reply") or "").strip() or "Give me a moment — what would you like to look at?",
            intent=str(intent) if intent is not None else None,
            actions=actions,
        )
    except ValidationError as exc:
        logger.warning("Agent response validation failed: %s", exc)
        return AgentChatResponse(
            reply=str(parsed.get("reply") or "Give me a moment — what would you like to look at?"),
            actions=actions,
        )


def _parse_agent_json(raw: str) -> dict:
    """Extract structured response from Claude — if JSON fails, treat prose as the reply (still natural, not canned)."""
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

    # Claude occasionally returns plain prose — use it as the reply rather than a hardcoded fallback
    if cleaned:
        return {"reply": cleaned, "intent": "other", "actions": []}
    return {"reply": "", "intent": "other", "actions": []}


def _extract_json_object(text: str) -> str | None:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    return match.group(0) if match else None
