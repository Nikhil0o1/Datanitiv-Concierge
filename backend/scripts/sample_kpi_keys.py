"""Sample KPI keys from cape-pg-data.sql for a capability id."""
import re
import sys
from pathlib import Path

cap = sys.argv[1] if len(sys.argv) > 1 else "CAP00010"
p = Path(__file__).resolve().parents[2] / "cape-pg-data.sql"
kpi: set[str] = set()
with p.open(encoding="utf-8", errors="replace") as f:
    for line in f:
        if "oneview_planner_dataset" not in line or cap not in line:
            continue
        for m in re.finditer(r"'(\d{4}-\d{2}-\d{2})',\s*'([^']+)',\s*([-0-9.eE+]+)", line):
            kpi.add(m.group(2))
        if len(kpi) > 80:
            break
print("KPI keys for", cap)
for k in sorted(kpi):
    print(" ", k)
