import asyncio

from app.database import AsyncSessionLocal
from app.routers.agent import agent_chat
from app.schemas import AgentChatRequest


async def main():
    async with AsyncSessionLocal() as session:
        for msg in ["Filter by ACE Retail", "Open CAP00010", "What plans need my decision?"]:
            r = await agent_chat(AgentChatRequest(message=msg, context_cap_id="CAP00010"), session)
            print("Q:", msg)
            print("A:", r.reply[:120])
            print("actions:", r.actions)
            print()


if __name__ == "__main__":
    asyncio.run(main())
