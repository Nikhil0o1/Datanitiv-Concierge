"""Extract public schema DDL from cape-pg-data.sql (first ~800 lines only)."""
import re
from pathlib import Path

SQL = Path(__file__).resolve().parents[2] / "cape-pg-data.sql"
OUT = Path(__file__).resolve().parents[1] / "schema" / "cape_public_schema.sql"

# Read only header — CREATE TABLE blocks are in first ~600 lines
head = SQL.read_text(encoding="utf-8", errors="replace")[:500_000]

# Split at first INSERT to avoid parsing data
if "INSERT INTO" in head:
    head = head.split("INSERT INTO")[0]

pattern = re.compile(
    r'CREATE TABLE "public"\."([^"]+)" \((.*?)\);',
    re.DOTALL,
)
tables = pattern.findall(head)

lines = [
    "-- Extracted public schema from cape-pg-data.sql (structure only, no data)",
    "BEGIN;",
]
for name, body in tables:
    lines.append(f'\nCREATE TABLE IF NOT EXISTS "public"."{name}" (')
    lines.append(body.strip())
    lines.append(");")

lines.append("\nCOMMIT;")
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text("\n".join(lines), encoding="utf-8")
print(f"Wrote {len(tables)} tables to {OUT}")
for name, _ in tables:
    print(f"  - {name}")
