"""Instant conversational acknowledgments — pre-cached ElevenLabs audio for sub-150ms playback."""

from __future__ import annotations

import base64
import hashlib
import logging
from pathlib import Path

from app.config import settings
from app.services.elevenlabs_tts import synthesize_mp3

logger = logging.getLogger(__name__)

CACHE_DIR = Path(__file__).resolve().parents[2] / "cache" / "voice_fillers"

FILLER_PHRASES: dict[str, list[str]] = {
    "lookup": [
        "One sec — let me look that up.",
        "Just a moment, pulling that up.",
        "Hang on — checking now.",
    ],
    "portfolio": [
        "Let me scan the portfolio real quick.",
        "One sec — checking the plans.",
        "Give me a second — looking at the numbers.",
    ],
    "navigate": [
        "Sure — pulling that up now.",
        "Got it, one sec.",
        "Okay — getting that on screen.",
    ],
    "action": [
        "On it — one moment.",
        "Sure thing, give me a sec.",
        "Got it — working on that now.",
    ],
}


def pick_filler_intent(message: str) -> str | None:
    """Return filler category only when the query likely needs lookup time."""
    text = (message or "").strip().lower()
    if not text or len(text) < 8:
        return None
    if text in {
        "hi",
        "hey",
        "hello",
        "yo",
        "sup",
        "hiya",
        "howdy",
        "thanks",
        "thank you",
        "ok",
        "okay",
        "good morning",
        "good afternoon",
        "good evening",
    }:
        return None
    if text.startswith(("hi ", "hey ", "hello ", "good morning", "good afternoon")) and len(text.split()) <= 5:
        if not any(w in text for w in ("what", "how", "show", "open", "worst", "plan", "portfolio", "need", "attention")):
            return None

    if any(w in text for w in ("what is", "what's", "explain", "tell me about", "how does", "why does", "define", "describe")):
        return "lookup"
    if any(w in text for w in ("worst", "urgent", "attention", "decide", "triage", "gap", "shortage", "portfolio", "compare")):
        return "portfolio"
    if any(w in text for w in ("open", "show me", "filter", "go to", "navigate", "switch to", "pull up")):
        return "navigate"
    if any(w in text for w in ("set", "adjust", "map", "execute", "submit", "attach", "upload", "change", "update", "shrink")):
        return "action"
    return None


def _cache_path(voice_id: str, model_id: str, phrase: str) -> Path:
    key = hashlib.sha256(f"{voice_id}|{model_id}|{phrase}".encode()).hexdigest()[:20]
    return CACHE_DIR / f"{key}.mp3"


async def get_filler_audio_for_phrase(intent: str, phrase: str) -> tuple[str, bytes]:
    """Return (phrase, mp3_bytes) — cached on disk after first synthesis."""
    voice_id = settings.elevenlabs_voice_id
    model_id = settings.elevenlabs_model
    path = _cache_path(voice_id, model_id, phrase)

    if path.is_file():
        return phrase, path.read_bytes()

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    audio = await synthesize_mp3(phrase)
    path.write_bytes(audio)
    logger.info("Cached voice filler %r -> %s", phrase, path.name)
    return phrase, audio


async def get_filler_audio(intent: str) -> tuple[str, bytes]:
    """Return first cached phrase for an intent (legacy single-filler endpoint)."""
    phrases = FILLER_PHRASES.get(intent) or FILLER_PHRASES.get("lookup") or []
    if not phrases:
        raise ValueError(f"Unknown filler intent: {intent}")
    return await get_filler_audio_for_phrase(intent, phrases[0])


async def build_filler_bundle() -> dict[str, list[dict[str, str]]]:
    """All filler phrases as base64 MP3 for client preload."""
    bundle: dict[str, list[dict[str, str]]] = {}
    for intent, phrases in FILLER_PHRASES.items():
        bundle[intent] = []
        for phrase in phrases:
            _, audio = await get_filler_audio_for_phrase(intent, phrase)
            bundle[intent].append(
                {
                    "text": phrase,
                    "audio_b64": base64.b64encode(audio).decode("ascii"),
                }
            )
    return bundle


async def warm_filler_cache() -> None:
    """Pre-generate every filler phrase so delayed acks never wait on synthesis."""
    if not settings.elevenlabs_api_key:
        return
    for intent, phrases in FILLER_PHRASES.items():
        for phrase in phrases:
            try:
                await get_filler_audio_for_phrase(intent, phrase)
            except Exception as exc:
                logger.warning("Filler cache warm failed for %s %r: %s", intent, phrase, exc)
