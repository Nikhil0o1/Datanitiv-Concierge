import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text

from app.database import AsyncSessionLocal, engine


async def main() -> None:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                """
                SELECT schemaname, relname AS tablename, n_live_tup AS row_estimate
                FROM pg_stat_user_tables
                WHERE schemaname IN ('public', 'pgboss')
                  AND relname NOT IN ('alembic_version')
                ORDER BY schemaname, relname
                """
            )
        )
        rows = result.fetchall()
        empty = []
        for schema, table, count in rows:
            exact = (
                await session.execute(text(f'SELECT COUNT(*) FROM "{schema}"."{table}"'))
            ).scalar_one()
            status = "OK" if exact > 0 else "EMPTY"
            if exact == 0:
                empty.append(f"{schema}.{table}")
            print(f"{schema}.{table}: {exact} rows [{status}]")
        print(f"\nTotal tables checked: {len(rows)}")
        if empty:
            print(f"Empty tables ({len(empty)}): {', '.join(empty)}")
        else:
            print("All tables have seed data.")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
