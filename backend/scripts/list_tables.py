import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text

from app.database import engine


async def main() -> None:
    async with engine.connect() as conn:
        result = await conn.execute(
            text(
                """
                SELECT schemaname, tablename
                FROM pg_tables
                WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
                ORDER BY schemaname, tablename
                """
            )
        )
        rows = result.fetchall()
        by_schema: dict[str, list[str]] = {}
        for schema, table in rows:
            by_schema.setdefault(schema, []).append(table)
        for schema, tables in sorted(by_schema.items()):
            print(f"\n{schema} ({len(tables)} tables):")
            for table in tables:
                print(f"  - {table}")
        print(f"\nTOTAL: {len(rows)} tables")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
