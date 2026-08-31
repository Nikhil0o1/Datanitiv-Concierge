import asyncio
import base64
import json
import logging
import re
import time

from anthropic import AsyncAnthropic
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.schemas import AgentChatRequest, AgentChatResponse
from app.services.agent_context import build_agent_context
from app.services.agent_harness import SYSTEM_PROMPT, VOICE_STREAM_SYSTEM_PROMPT, build_claude_messages
from app.services.action_enrichment import enrich_actions
from app.services.agent_stream import extract_partial_reply, parse_stream_response, sse_event
from app.services.elevenlabs_stream_tts import StreamTTS
from app.services.usage_tracker import record_llm_usage

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
        t0 = time.perf_counter()
        try:
            response = await client.messages.create(
                model=settings.anthropic_model,
                max_tokens=2048,
                system=SYSTEM_PROMPT,
                messages=messages,
            )
        except Exception as exc:
            latency_ms = (time.perf_counter() - t0) * 1000
            asyncio.create_task(
                record_llm_usage(
                    model=settings.anthropic_model,
                    endpoint="agent.chat",
                    success=False,
                    latency_ms=latency_ms,
                )
            )
            logger.exception("Claude API call failed")
            raise HTTPException(status_code=502, detail=f"Claude API error: {exc}") from exc

        latency_ms = (time.perf_counter() - t0) * 1000
        raw = response.content[0].text if response.content else ""
        asyncio.create_task(
            record_llm_usage(
                model=settings.anthropic_model,
                endpoint="agent.chat",
                usage=getattr(response, "usage", None),
                latency_ms=latency_ms,
            )
        )
        parsed = _parse_agent_json(raw)
        parsed["actions"] = enrich_actions(
            parsed.get("actions"),
            reply=parsed.get("reply") or "",
            user_message=body.message,
            history=history,
            active_cap_id=body.context_cap_id,
        )
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


@router.post("/chat/stream")
async def agent_chat_stream(body: AgentChatRequest, session: AsyncSession = Depends(get_db)):
    """Stream Claude reply tokens as SSE so the client can speak while text generates."""
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
    except Exception as exc:
        logger.exception("agent_chat_stream setup failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    async def event_generator():
        from app.concierge.services.business_events import emit_business_event

        buffer = ""
        last_sent = ""
        events: asyncio.Queue[dict | None] = asyncio.Queue()
        tts: StreamTTS | None = None
        is_voice = body.source == "voice"
        stream_system = VOICE_STREAM_SYSTEM_PROMPT if is_voice else SYSTEM_PROMPT

        await emit_business_event(
            event_type="agent.chat.started",
            metadata={"source": body.source, "cap_id": body.context_cap_id, "stream": True},
        )

        async def pump_tts_audio() -> None:
            if not tts:
                await events.put({"type": "_tts_done"})
                return
            try:
                async for pcm in tts.iter_audio():
                    await events.put(
                        {
                            "type": "audio",
                            "data": base64.b64encode(pcm).decode("ascii"),
                            "format": "pcm_24000",
                        }
                    )
            except Exception as exc:
                logger.warning("TTS audio pump failed: %s", exc)
            finally:
                await events.put({"type": "_tts_done"})

        if settings.elevenlabs_api_key:
            tts = await _connect_stream_tts(settings.elevenlabs_api_key)
            if tts:
                asyncio.create_task(pump_tts_audio())
            else:
                await events.put({"type": "_tts_done"})
        else:
            await events.put({"type": "_tts_done"})

        client = AsyncAnthropic(api_key=settings.anthropic_api_key)

        async def run_claude() -> None:
            nonlocal buffer, last_sent
            t0 = time.perf_counter()
            try:
                async with client.messages.stream(
                    model=settings.anthropic_model,
                    max_tokens=2048,
                    system=stream_system,
                    messages=messages,
                ) as stream:
                    async for text in stream.text_stream:
                        buffer += text
                        partial = extract_partial_reply(buffer, voice=is_voice)
                        if partial and partial != last_sent:
                            last_sent = partial
                            await events.put({"type": "delta", "reply": partial})
                            if tts:
                                await tts.feed_text(partial)

                    final_message = await stream.get_final_message()
                    latency_ms = (time.perf_counter() - t0) * 1000
                    asyncio.create_task(
                        record_llm_usage(
                            model=settings.anthropic_model,
                            endpoint="agent.chat.stream",
                            usage=getattr(final_message, "usage", None),
                            latency_ms=latency_ms,
                        )
                    )

                parsed = parse_stream_response(buffer, voice=is_voice)
                reply_text = parsed.get("reply") or last_sent
                enriched_actions = enrich_actions(
                    parsed.get("actions"),
                    reply=reply_text,
                    user_message=body.message,
                    history=history,
                    active_cap_id=body.context_cap_id,
                )
                await emit_business_event(
                    event_type="agent.chat.completed",
                    metadata={
                        "intent": parsed.get("intent"),
                        "action_count": len(enriched_actions),
                        "stream": True,
                    },
                )
                await events.put(
                    {
                        "type": "done",
                        "reply": reply_text,
                        "intent": parsed.get("intent"),
                        "actions": enriched_actions,
                    }
                )
            except Exception as exc:
                latency_ms = (time.perf_counter() - t0) * 1000
                asyncio.create_task(
                    record_llm_usage(
                        model=settings.anthropic_model,
                        endpoint="agent.chat.stream",
                        success=False,
                        latency_ms=latency_ms,
                    )
                )
                logger.exception("Claude stream failed")
                await emit_business_event(
                    event_type="agent.chat.failed",
                    severity="error",
                    error_code="AGENT_CHAT_STREAM_ERROR",
                    metadata={"error": str(exc)[:200]},
                )
                await events.put({"type": "error", "detail": str(exc)[:220]})
            finally:
                if tts:
                    await tts.finish()
                await events.put({"type": "_claude_done"})

        asyncio.create_task(run_claude())

        tts_done = tts is None
        claude_done = False
        while not (tts_done and claude_done):
            event = await events.get()
            if event is None:
                break
            if event["type"] == "_tts_done":
                tts_done = True
                continue
            if event["type"] == "_claude_done":
                claude_done = True
                continue
            yield sse_event(event)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


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


async def _connect_stream_tts(api_key: str) -> StreamTTS | None:
    from app.services.elevenlabs_stream_tts import connect_stream_tts

    return await connect_stream_tts(api_key)
