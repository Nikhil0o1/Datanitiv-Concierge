from __future__ import annotations

from dataclasses import dataclass
from typing import Any


def f2(n: float) -> str:
    return f"{round(n * 100) / 100:.2f}"


def f1(n: float) -> str:
    return f"{round(n * 10) / 10:.1f}"


def status_of(plan: dict[str, Any]) -> str:
    s = plan["sustained"]
    if s <= -10:
        return "critical"
    if s < -1:
        return "under"
    if s > 1:
        return "surplus"
    return "balanced"


def shr_gap(plan: dict[str, Any]) -> float:
    i = plan["curIdx"]
    s_shrink = plan.get("sShrink") or []
    s = [v for v in s_shrink[max(0, i - 8) : i + 1] if v is not None]
    if not s:
        return 0.0
    return sum(s) / len(s) - plan["shrink12"]


@dataclass
class TriageItem:
    plan: dict[str, Any]
    why: str
    bucket: str
    tag: str
    tag_class: str


def triage_plans(plans: list[dict[str, Any]]) -> dict[str, list[TriageItem]]:
    """Port exact triage logic from prototype.html into dec/auto/quiet buckets."""
    dec: list[TriageItem] = []
    auto: list[TriageItem] = []
    quiet: list[TriageItem] = []

    for p in plans:
        st = status_of(p)
        sg = shr_gap(p)
        weeks = p.get("weeks") or []
        cur_idx = p.get("curIdx", 0)

        if st == "under" or st == "critical" or p.get("minOUfwd", p.get("min_ou_fwd", 0)) < -6:
            why = (
                f"Short {f2(-p['sustained'])} FTE sustained · worst week {f2(p.get('minOUfwd', p.get('min_ou_fwd', 0)))}"
                if st in ("under", "critical")
                else f"Looks fine now · {f2(p.get('minOUfwd', p.get('min_ou_fwd', 0)))} FTE by {(weeks[cur_idx + 9] if cur_idx + 9 < len(weeks) else '')}"
            )
            dec.append(TriageItem(p, why, "dec", "decision", "dec"))
        elif sg > 10:
            shrink12 = p["shrink12"]
            auto.append(
                TriageItem(
                    p,
                    f"Shrinkage plan {f1(shrink12)}% vs {f1(shrink12 + sg)}% actual",
                    "auto",
                    "autopilot",
                    "auto",
                )
            )
        else:
            quiet.append(
                TriageItem(
                    p,
                    f"Inside tolerance · worst week {f2(p.get('minOUfwd', p.get('min_ou_fwd', 0)))}",
                    "quiet",
                    "folded",
                    "ok",
                )
            )

    return {"dec": dec, "auto": auto, "quiet": quiet}
