import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response

from app.config import settings
from app.schemas import VoiceSTTResponse, VoiceTTSRequest

router = APIRouter(prefix="/voice", tags=["voice"])

ELEVENLABS_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text"
ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"


def _require_elevenlabs_key() -> str:
    if not settings.elevenlabs_api_key:
        raise HTTPException(status_code=503, detail="ElevenLabs API key not configured")
    return settings.elevenlabs_api_key


@router.post("/stt", response_model=VoiceSTTResponse)
async def speech_to_text(audio: UploadFile = File(...)):
    api_key = _require_elevenlabs_key()
    content = await audio.read()

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            ELEVENLABS_STT_URL,
            headers={"xi-api-key": api_key},
            files={"file": (audio.filename or "audio.webm", content, audio.content_type or "audio/webm")},
            data={"model_id": "scribe_v1"},
        )

    if response.status_code != 200:
        raise HTTPException(status_code=response.status_code, detail=response.text)

    data = response.json()
    text = data.get("text") or data.get("transcription") or ""
    return VoiceSTTResponse(text=text)


@router.post("/tts")
async def text_to_speech(body: VoiceTTSRequest):
    api_key = _require_elevenlabs_key()
    url = ELEVENLABS_TTS_URL.format(voice_id=body.voice_id)

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            url,
            headers={
                "xi-api-key": api_key,
                "Content-Type": "application/json",
                "Accept": "audio/mpeg",
            },
            json={
                "text": body.text,
                "model_id": "eleven_multilingual_v2",
            },
        )

    if response.status_code != 200:
        raise HTTPException(status_code=response.status_code, detail=response.text)

    return Response(content=response.content, media_type="audio/mpeg")
