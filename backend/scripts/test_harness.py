import asyncio

from httpx import ASGITransport, AsyncClient

from app.main import app


async def main():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", timeout=90) as client:
        tests = [
            "i just a shrink it",
            "show me bad plan worst one",
            "yes open that",
        ]
        history = []
        for msg in tests:
            r = await client.post(
                "/api/agent/chat",
                json={
                    "message": msg,
                    "context_cap_id": "CAP00010",
                    "ui_state": {"view": "port", "filter": "all"},
                    "history": history,
                    "source": "voice",
                },
            )
            data = r.json()
            print("USER:", msg)
            print("VERA:", data.get("reply", "")[:200])
            print("ACTIONS:", data.get("actions"))
            print()
            history.append({"role": "user", "content": msg})
            history.append({"role": "assistant", "content": data.get("reply", "")})


if __name__ == "__main__":
    asyncio.run(main())
