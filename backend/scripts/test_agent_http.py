import asyncio

import httpx


async def main():
    async with httpx.AsyncClient(timeout=90) as client:
        payload = {
            "message": "Hello",
            "context_cap_id": "CAP00010",
            "ui_state": {"view": "port", "filter": "all", "active_tab": "ov", "human_mode": False},
        }
        r = await client.post("http://127.0.0.1:8000/api/agent/chat", json=payload)
        print("status:", r.status_code)
        print(r.text[:1500])


if __name__ == "__main__":
    asyncio.run(main())
