import asyncio

from anthropic import AsyncAnthropic

from app.config import settings

MODELS = [
    "claude-sonnet-4-6",
    "claude-3-5-sonnet-20241022",
    "claude-3-7-sonnet-20250219",
    "claude-3-5-haiku-20241022",
]


async def main():
    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    for model in MODELS:
        try:
            r = await client.messages.create(
                model=model,
                max_tokens=40,
                messages=[{"role": "user", "content": 'Reply JSON only: {"reply":"hello"}'}],
            )
            print(model, "OK", r.content[0].text[:80])
        except Exception as e:
            print(model, "FAIL", str(e)[:140])


if __name__ == "__main__":
    asyncio.run(main())
