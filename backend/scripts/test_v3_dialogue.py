"""Smoke-test ElevenLabs v3 conversational streaming."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from dotenv import load_dotenv

load_dotenv()


async def main() -> None:
    from app.config import settings
    from app.services.elevenlabs_stream_tts import create_stream_tts
    from app.services.elevenlabs_tts import synthesize_mp3

    assert settings.elevenlabs_api_key, "ELEVENLABS_API_KEY required"

    mp3 = await synthesize_mp3("Hey — one sec, let me look that up.")
    print(f"HTTP dialogue MP3: {len(mp3)} bytes")

    tts = create_stream_tts(settings.elevenlabs_api_key)
    await tts.connect()
    await tts.feed_text("Capacity planning is how we match ")
    await tts.feed_text("Capacity planning is how we match headcount to workload.")
    await tts.finish()

    total = 0
    async for chunk in tts.iter_audio():
        total += len(chunk)
    print(f"WS dialogue PCM: {total} bytes")
    print("ok")


if __name__ == "__main__":
    asyncio.run(main())
