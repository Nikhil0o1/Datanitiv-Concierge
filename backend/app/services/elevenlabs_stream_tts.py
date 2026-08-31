"""ElevenLabs streaming TTS — Flash/Turbo via TTS WS, v3 via Text-to-Dialogue WS."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from typing import Protocol

import websockets

from app.config import settings
from app.services.elevenlabs_tts import dialogue_voice_settings, is_v3_model

logger = logging.getLogger(__name__)

CHUNK_SCHEDULE = [50, 55, 65, 75]
TTS_WS = "wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input"
DIALOGUE_WS = "wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input"


class StreamTTS(Protocol):
    async def connect(self) -> None: ...
    async def feed_text(self, full_reply: str) -> None: ...
    async def finish(self) -> None: ...
    def iter_audio(self): ...


class _AudioQueueMixin:
    def _init_queue(self) -> None:
        self._audio_queue: asyncio.Queue[bytes | None] = asyncio.Queue()
        self._reader_task: asyncio.Task | None = None
        self._sent_len = 0
        self._closed = False

    async def _read_loop_generic(self, ws) -> None:
        try:
            async for raw in ws:
                msg = json.loads(raw)
                if msg.get("error"):
                    logger.warning("ElevenLabs stream error: %s", msg.get("error"))
                    break
                if msg.get("audio"):
                    await self._audio_queue.put(base64.b64decode(msg["audio"]))
                if msg.get("is_final") is True or msg.get("isFinal") is True:
                    break
        except Exception as exc:
            logger.warning("ElevenLabs stream read error: %s", exc)
        finally:
            await self._audio_queue.put(None)

    async def iter_audio(self):
        while True:
            chunk = await self._audio_queue.get()
            if chunk is None:
                break
            yield chunk


class ElevenLabsClassicStreamTTS(_AudioQueueMixin):
    """Flash / Turbo — `/v1/text-to-speech/{voice_id}/stream-input`."""

    def __init__(
        self,
        api_key: str,
        *,
        voice_id: str | None = None,
        model_id: str | None = None,
        output_format: str = "pcm_24000",
    ) -> None:
        self.api_key = api_key
        self.voice_id = voice_id or settings.elevenlabs_voice_id
        self.model_id = model_id or settings.elevenlabs_model
        self.output_format = output_format
        self._ws = None
        self._init_queue()

    async def connect(self) -> None:
        uri = (
            f"{TTS_WS.format(voice_id=self.voice_id)}"
            f"?model_id={self.model_id}&output_format={self.output_format}&auto_mode=true"
        )
        self._ws = await websockets.connect(
            uri,
            additional_headers={"xi-api-key": self.api_key},
            open_timeout=15,
        )
        await self._ws.send(
            json.dumps(
                {
                    "text": " ",
                    "voice_settings": settings.elevenlabs_voice_settings,
                    "generation_config": {"chunk_length_schedule": CHUNK_SCHEDULE},
                }
            )
        )
        self._reader_task = asyncio.create_task(self._read_loop_generic(self._ws))

    async def feed_text(self, full_reply: str) -> None:
        if self._closed or not self._ws:
            return
        delta = full_reply[self._sent_len :]
        if not delta:
            return
        self._sent_len = len(full_reply)
        text = delta if delta.endswith(" ") else f"{delta} "
        payload: dict = {"text": text}
        stripped = full_reply.rstrip()
        if len(full_reply) < 55 and stripped and stripped[-1] in ".!?":
            payload["try_trigger_generation"] = True
        await self._ws.send(json.dumps(payload))

    async def finish(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._ws:
            try:
                await self._ws.send(json.dumps({"text": " ", "flush": True}))
                await self._ws.send(json.dumps({"text": ""}))
            except Exception:
                pass
            try:
                await self._ws.close()
            except Exception:
                pass
        if self._reader_task:
            await self._reader_task


class ElevenLabsDialogueStreamTTS(_AudioQueueMixin):
    """v3 / v3_conversational — `/v1/text-to-dialogue/stream-input`."""

    def __init__(
        self,
        api_key: str,
        *,
        voice_id: str | None = None,
        model_id: str | None = None,
        output_format: str = "pcm_24000",
    ) -> None:
        self.api_key = api_key
        self.voice_id = voice_id or settings.elevenlabs_voice_id
        self.model_id = model_id or settings.elevenlabs_model
        self.output_format = output_format
        self._ws = None
        self._new_turn = True
        self._first_flush = False
        self._init_queue()

    async def connect(self) -> None:
        uri = f"{DIALOGUE_WS}?model_id={self.model_id}&output_format={self.output_format}"
        self._ws = await websockets.connect(
            uri,
            additional_headers={"xi-api-key": self.api_key},
            open_timeout=15,
        )
        await self._ws.send(
            json.dumps(
                {
                    "voices": [self.voice_id],
                    "voice_settings": dialogue_voice_settings(),
                }
            )
        )
        self._reader_task = asyncio.create_task(self._read_loop_generic(self._ws))

    async def feed_text(self, full_reply: str) -> None:
        if self._closed or not self._ws:
            return
        delta = full_reply[self._sent_len :]
        if not delta:
            return
        self._sent_len = len(full_reply)
        payload: dict = {
            "inputs": [
                {
                    "text": delta,
                    "voice_id": self.voice_id,
                    "new_turn": self._new_turn,
                }
            ]
        }
        self._new_turn = False
        stripped = full_reply.rstrip()
        if not self._first_flush and len(full_reply.strip()) >= 12:
            payload["flush"] = True
            self._first_flush = True
        elif len(full_reply) < 80 and stripped and stripped[-1] in ".!?":
            payload["flush"] = True
        await self._ws.send(json.dumps(payload))

    async def finish(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._ws:
            try:
                await self._ws.send(json.dumps({"flush": True}))
                await self._ws.send(json.dumps({"close_socket": True}))
            except Exception:
                pass
            if self._reader_task:
                await self._reader_task
            try:
                await self._ws.close()
            except Exception:
                pass


def create_stream_tts(api_key: str, **kwargs) -> StreamTTS:
    """Pick the correct streaming protocol for the configured ElevenLabs model."""
    model_id = kwargs.get("model_id") or settings.elevenlabs_model
    if is_v3_model(model_id):
        logger.info("ElevenLabs stream TTS: using Text-to-Dialogue WS (%s)", model_id)
        return ElevenLabsDialogueStreamTTS(api_key, **kwargs)
    logger.info("ElevenLabs stream TTS: using classic TTS WS (%s)", model_id)
    return ElevenLabsClassicStreamTTS(api_key, **kwargs)


async def connect_stream_tts(api_key: str) -> StreamTTS | None:
    """Connect streaming TTS; fall back to flash classic WS if v3 dialogue fails."""
    from app.services.elevenlabs_tts import FLASH_FALLBACK_MODEL, is_v3_model

    try:
        tts = create_stream_tts(api_key)
        await tts.connect()
        return tts
    except Exception as exc:
        logger.warning("Primary stream TTS connect failed: %s", exc)
        if is_v3_model(settings.elevenlabs_model):
            try:
                tts = create_stream_tts(api_key, model_id=FLASH_FALLBACK_MODEL)
                await tts.connect()
                logger.info("Stream TTS connected via flash fallback")
                return tts
            except Exception as fallback_exc:
                logger.warning("Flash stream TTS fallback failed: %s", fallback_exc)
        return None


# Back-compat alias used by agent router
ElevenLabsStreamTTS = create_stream_tts
