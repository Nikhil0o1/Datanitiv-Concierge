import asyncio
import traceback

from app.database import AsyncSessionLocal
from app.routers.agent import agent_chat
from app.schemas import AgentChatRequest


async def main():
    async with AsyncSessionLocal() as session:
        try:
            result = await agent_chat(
                AgentChatRequest(message="What is your name?", context_cap_id="CAP00010"),
                session,
            )
            print("OK:", result)
        except Exception:
            traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
