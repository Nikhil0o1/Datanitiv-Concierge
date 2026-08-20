import asyncio
import traceback

from httpx import ASGITransport, AsyncClient

from app.main import app


async def main():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "message": "Hello",
            "context_cap_id": "CAP00010",
            "ui_state": {"view": "port", "filter": "all", "active_tab": "ov", "human_mode": False},
        }
        r = await client.post("/api/agent/chat", json=payload)
        print("status:", r.status_code)
        print(r.text[:2000])


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception:
        traceback.print_exc()
