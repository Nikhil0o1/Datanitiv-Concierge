"""Drop data, apply migrations, and seed prototype data into all Cape tables."""

from __future__ import annotations

import asyncio
import subprocess
import sys
from pathlib import Path

from sqlalchemy import text

BACKEND_ROOT = Path(__file__).resolve().parents[1]

TRUNCATE_SQL = """
TRUNCATE TABLE
    public.cape_chat_messages,
    public.cape_chat_sessions,
    public.cape_reminders,
    public.cape_recommendation_thresholds,
    public.oneview_roster_role,
    public.oneview_roster_log,
    public.oneview_roster_work_status,
    public.oneview_new_hire,
    public.oneview_header_details,
    public.oneview_planner_dataset,
    public.oneview_shrinkage,
    public.oneview_budget,
    public.oneview_roster_summary,
    public.oneview_attrition_assumption,
    public.oneview_hierarchy,
    public.oneview_title_translation,
    public.app_settings,
    public.schema_migrations
RESTART IDENTITY CASCADE;

TRUNCATE TABLE
    pgboss.archive,
    pgboss.job,
    pgboss.subscription,
    pgboss.schedule,
    pgboss.queue,
    pgboss.version
CASCADE;
"""


async def _prepare_and_seed() -> None:
    from app.database import AsyncSessionLocal, engine
    from app.services.seed import seed_database

    async with engine.begin() as conn:
        await conn.execute(text(TRUNCATE_SQL))
    async with AsyncSessionLocal() as session:
        counts = await seed_database(session)
        print(counts)
    await engine.dispose()


def main() -> None:
    sys.path.insert(0, str(BACKEND_ROOT))
    alembic = BACKEND_ROOT / ".venv" / "Scripts" / "alembic.exe"
    subprocess.run([str(alembic), "upgrade", "head"], cwd=BACKEND_ROOT, check=True)
    asyncio.run(_prepare_and_seed())
    print("Database reset and full seed complete.")


if __name__ == "__main__":
    main()
