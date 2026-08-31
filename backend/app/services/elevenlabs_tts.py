"""ElevenLabs helpers — model routing between classic TTS and v3 Text-to-Dialogue."""

from __future__ import annotations

import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
ELEVENLABS_DIALOGUE_STREAM_URL = "https://api.elevenlabs.io/v1/text-to-dialogue/stream"

FLASH_FALLBACK_MODEL = "eleven_flash_v2_5"


def is_v3_model(model_id: str | None = None) -> bool:
    model = (model_id or settings.elevenlabs_model or "").strip()
    return model.startswith("eleven_v3")


def dialogue_voice_settings() -> dict:
    """Voice settings tuned for eleven_v3_conversational (expressive spoken delivery)."""
    return {
        "stability": settings.elevenlabs_voice_stability,
        "similarity_boost": settings.elevenlabs_voice_similarity,
        "speed": settings.elevenlabs_voice_speed,
        "use_speaker_boost": True,
    }


async def synthesize_mp3(text: str, *, api_key: str | None = None) -> bytes:
    """Synthesize short utterances (fillers, fallback TTS) using the configured model."""
    key = api_key or settings.elevenlabs_api_key
    if not key:
        raise RuntimeError("ElevenLabs API key not configured")

    if is_v3_model():
        try:
            return await _synthesize_dialogue_mp3(text, api_key=key)
        except Exception as exc:
            logger.warning("Dialogue TTS failed, falling back to flash: %s", exc)
            return await _synthesize_classic_mp3(text, api_key=key, model_id=FLASH_FALLBACK_MODEL)
    return await _synthesize_classic_mp3(text, api_key=key)


async def _synthesize_classic_mp3(text: str, *, api_key: str, model_id: str | None = None) -> bytes:
    voice_id = settings.elevenlabs_voice_id
    url = ELEVENLABS_TTS_URL.format(voice_id=voice_id)
    model = model_id or settings.elevenlabs_model
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            url,
            headers={
                "xi-api-key": api_key,
                "Content-Type": "application/json",
                "Accept": "audio/mpeg",
            },
            json={
                "text": text,
                "model_id": model,
                "voice_settings": settings.elevenlabs_voice_settings,
            },
            params={"optimize_streaming_latency": 4},
        )
    if response.status_code != 200:
        raise RuntimeError(f"TTS failed: {response.status_code} {response.text[:160]}")
    return response.content


async def _synthesize_dialogue_mp3(text: str, *, api_key: str) -> bytes:
    voice_id = settings.elevenlabs_voice_id
    async with httpx.AsyncClient(timeout=60.0) as client:
        async with client.stream(
            "POST",
            ELEVENLABS_DIALOGUE_STREAM_URL,
            headers={
                "xi-api-key": api_key,
                "Content-Type": "application/json",
                "Accept": "audio/mpeg",
            },
            json={
                "model_id": settings.elevenlabs_model,
                "inputs": [{"text": text, "voice_id": voice_id}],
            },
        ) as response:
            if response.status_code != 200:
                body = (await response.aread())[:160]
                raise RuntimeError(f"Dialogue TTS failed: {response.status_code} {body!r}")
            chunks: list[bytes] = []
            async for chunk in response.aiter_bytes():
                if chunk:
                    chunks.append(chunk)
    return b"".join(chunks)
