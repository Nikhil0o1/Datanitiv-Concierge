"""Apply Cape public schema from cape-pg-data.sql structure."""

from pathlib import Path
from typing import Sequence, Union

from alembic import op

revision: str = "001_cape_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "schema" / "cape_full_schema.sql"


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
    op.execute("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;")
