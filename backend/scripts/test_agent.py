import asyncio
import json

import httpx


async def main():
    async with httpx.AsyncClient(timeout=60) as client:
        for msg in ["What is your name?", "Filter by ACE Retail", "Hello"]:
            r = await client.post(
                "http://127.0.0.1:8000/api/agent/chat",
                json={"message": msg, "context_cap_id": "CAP00010"},
            )
            print("===", msg, "===", r.status_code)
            print(r.text[:800])
            print()


if __name__ == "__main__":
    asyncio.run(main())
