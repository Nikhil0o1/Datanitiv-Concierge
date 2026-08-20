"""Add pgBoss job queue schema from cape-pg-data.sql."""

from pathlib import Path
from typing import Sequence, Union

from alembic import op

revision: str = "002_pgboss_schema"
down_revision: Union[str, None] = "001_cape_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "schema" / "pgboss_schema.sql"


def _statements(sql: str) -> list[str]:
    parts: list[str] = []
    for chunk in sql.split(";"):
        statement = chunk.strip()
        if statement:
            parts.append(f"{statement};")
    return parts


def upgrade() -> None:
    sql = SCHEMA_PATH.read_text(encoding="utf-8")
    for statement in _statements(sql):
        op.execute(statement)


def downgrade() -> None:
    op.execute("DROP SCHEMA IF EXISTS pgboss CASCADE;")
