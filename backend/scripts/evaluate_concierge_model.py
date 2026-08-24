"""Periodic Concierge model evaluation — run weekly/monthly."""

import asyncio

from app.concierge.services.training import build_dataset_stats, evaluate_and_register_version
from app.database import AsyncSessionLocal


async def main() -> None:
    async with AsyncSessionLocal() as session:
        stats = await build_dataset_stats(session)
        print("Dataset stats:", stats)
        version = await evaluate_and_register_version(session, "candidate-auto")
        print(f"Registered version {version.version}, active={version.is_active}, metrics={version.metrics}")


if __name__ == "__main__":
    asyncio.run(main())
