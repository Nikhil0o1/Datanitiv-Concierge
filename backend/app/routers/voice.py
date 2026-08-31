import logging
import asyncio
import base64

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse

from app.config import settings
from app.schemas import VoiceSTTResponse, VoiceTTSRequest
from app.services.agent_stream import sse_event
from app.services.elevenlabs_stream_tts import connect_stream_tts
from app.services.elevenlabs_tts import synthesize_mp3
from app.services.stt_utils import assess_transcription_quality
from app.services.voice_fillers import build_filler_bundle, get_filler_audio, pick_filler_intent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/voice", tags=["voice"])

ELEVENLABS_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text"


def _require_elevenlabs_key() -> str:
    if not settings.elevenlabs_api_key:
        raise HTTPException(status_code=503, detail="ElevenLabs API key not configured")
    return settings.elevenlabs_api_key


async def _run_stt(client: httpx.AsyncClient, api_key: str, content: bytes, filename: str, content_type: str) -> dict:
    response = await client.post(
        ELEVENLABS_STT_URL,
        headers={"xi-api-key": api_key},
        files={"file": (filename, content, content_type)},
        data={
            "model_id": settings.elevenlabs_stt_model,
            "language_code": settings.elevenlabs_stt_language,
        },
    )
    if response.status_code != 200:
        raise HTTPException(status_code=response.status_code, detail=response.text[:240])
    return response.json()


@router.post("/stt", response_model=VoiceSTTResponse)
async def speech_to_text(audio: UploadFile = File(...)):
    api_key = _require_elevenlabs_key()
    content = await audio.read()
    filename = audio.filename or "audio.webm"
    content_type = audio.content_type or "audio/webm"

    async with httpx.AsyncClient(timeout=60.0) as client:
        data = await _run_stt(client, api_key, content, filename, content_type)

    text = (data.get("text") or data.get("transcription") or "").strip()
    language_code = data.get("language_code") or data.get("detected_language")
    language_probability = data.get("language_probability")
    if language_probability is not None:
        try:
            language_probability = float(language_probability)
        except (TypeError, ValueError):
            language_probability = None

    quality = assess_transcription_quality(
        text,
        language_code=language_code,
        language_probability=language_probability,
    )

    if quality == "retry_suggested" and content:
        logger.info("STT quality retry — first pass lang=%s text=%r", language_code, text[:80])
        async with httpx.AsyncClient(timeout=60.0) as client:
            retry_data = await _run_stt(client, api_key, content, filename, content_type)
        retry_text = (retry_data.get("text") or retry_data.get("transcription") or "").strip()
        retry_lang = retry_data.get("language_code") or retry_data.get("detected_language")
        retry_prob = retry_data.get("language_probability")
        if retry_prob is not None:
            try:
                retry_prob = float(retry_prob)
            except (TypeError, ValueError):
                retry_prob = None
        retry_quality = assess_transcription_quality(
            retry_text,
            language_code=retry_lang,
            language_probability=retry_prob,
        )
        if retry_quality in ("good", "uncertain") and retry_text:
            text = retry_text
            language_code = retry_lang
            language_probability = retry_prob
            quality = retry_quality

    return VoiceSTTResponse(
        text=text,
        language_code=language_code,
        language_probability=language_probability,
        transcription_quality=quality,
    )


@router.post("/tts")
async def text_to_speech(body: VoiceTTSRequest):
    api_key = _require_elevenlabs_key()
    try:
        audio = await synthesize_mp3(body.text, api_key=api_key)
    except Exception as exc:
        logger.warning("TTS synthesis failed: %s", exc)
        raise HTTPException(status_code=502, detail="Voice synthesis temporarily unavailable") from exc
    return Response(content=audio, media_type="audio/mpeg")


@router.post("/tts/stream")
async def text_to_speech_stream(body: VoiceTTSRequest):
    """Stream PCM audio chunks (SSE) for fixed text — same path as agent chat TTS."""
    api_key = _require_elevenlabs_key()
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    async def generate():
        tts = await connect_stream_tts(api_key)
        if not tts:
            yield sse_event({"type": "error", "detail": "Streaming TTS unavailable"})
            return

        async def feed_and_finish() -> None:
            try:
                await tts.feed_text(text)
                await tts.finish()
            except Exception as exc:
                logger.warning("Stream TTS feed failed: %s", exc)

        feed_task = asyncio.create_task(feed_and_finish())
        try:
            async for pcm in tts.iter_audio():
                yield sse_event(
                    {
                        "type": "audio",
                        "data": base64.b64encode(pcm).decode("ascii"),
                        "format": "pcm_24000",
                    }
                )
            await feed_task
            yield sse_event({"type": "done"})
        except Exception as exc:
            logger.warning("Stream TTS pump failed: %s", exc)
            yield sse_event({"type": "error", "detail": str(exc)[:220]})
        finally:
            if not feed_task.done():
                feed_task.cancel()

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/fillers/bundle")
async def voice_fillers_bundle():
    """Pre-cached filler phrases for delayed client-side playback."""
    if not settings.elevenlabs_api_key:
        raise HTTPException(status_code=503, detail="ElevenLabs API key not configured")
    try:
        bundle = await build_filler_bundle()
    except Exception as exc:
        logger.warning("Filler bundle failed: %s", exc)
        raise HTTPException(status_code=502, detail="Voice filler cache unavailable") from exc
    return bundle


@router.get("/filler/{intent}")
async def voice_filler(intent: str):
    """Pre-cached instant acknowledgment audio — legacy single-phrase endpoint."""
    if not settings.elevenlabs_api_key:
        raise HTTPException(status_code=503, detail="ElevenLabs API key not configured")
    try:
        phrase, audio = await get_filler_audio(intent)
    except Exception as exc:
        logger.warning("Filler fetch failed: %s", exc)
        raise HTTPException(status_code=502, detail="Voice filler unavailable") from exc
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={"X-Filler-Text": phrase, "Cache-Control": "public, max-age=86400"},
    )


@router.get("/filler")
async def voice_filler_auto(message: str = ""):
    """Pick intent from user message and return cached filler audio."""
    intent = pick_filler_intent(message)
    if not intent:
        raise HTTPException(status_code=204, detail="No filler needed")
    return await voice_filler(intent)
