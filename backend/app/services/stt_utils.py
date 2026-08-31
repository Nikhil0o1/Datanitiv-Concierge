"""STT quality helpers — English-first transcription for Vera voice."""

from __future__ import annotations

import re

DEVANAGARI_RE = re.compile(r"[\u0900-\u097F]")
NON_ENGLISH_LANG_PREFIXES = ("mar", "hin", "tam", "tel", "ben", "guj", "kan", "mal", "pan", "urd")


def contains_devanagari(text: str) -> bool:
    return bool(DEVANAGARI_RE.search(text or ""))


def normalize_language_code(code: str | None) -> str:
    return (code or "").strip().lower().replace("_", "-")


def assess_transcription_quality(
    text: str,
    *,
    language_code: str | None = None,
    language_probability: float | None = None,
) -> str:
    """Return good | uncertain | retry_suggested."""
    stripped = (text or "").strip()
    if not stripped:
        return "retry_suggested"

    lang = normalize_language_code(language_code)
    if lang and not lang.startswith("en") and lang[:3] not in ("eng",):
        if lang.startswith(NON_ENGLISH_LANG_PREFIXES):
            return "retry_suggested"

    if contains_devanagari(stripped):
        return "retry_suggested"

    if language_probability is not None and language_probability < 0.55:
        return "uncertain"

    if len(stripped) < 3:
        return "uncertain"

    return "good"
