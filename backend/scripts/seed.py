"""CLI entrypoint to seed prototype data when hierarchy table is empty."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import AsyncSessionLocal, engine
from app.services.seed import seed_database


async def main() -> None:
    async with AsyncSessionLocal() as session:
        counts = await seed_database(session)
        print(counts)
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
