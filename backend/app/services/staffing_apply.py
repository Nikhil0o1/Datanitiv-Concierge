"""Apply accepted staffing packages (OT / cross-util / hire) to live plan series."""

from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import OneviewHeaderDetails, OneviewNewHire, OneviewPlannerDataset
from app.services.plan_repository import KPI_OU, KPI_PROJ, cap_to_cp, load_all_plans, load_plan, update_plan_meta


HIRE_YIELD = 0.97 * 0.98 * 0.99  # same factors as frontend planRec


def package_fte_parts(pkg: dict, avail_hrs: float = 40.0) -> tuple[float, float, float]:
    """Return (ot_fte, xu_fte, hire_fte). Hire uses production yield on starts."""
    if pkg.get("ot_fte") is not None:
        ot_fte = float(pkg.get("ot_fte") or 0)
    else:
        avail = float(avail_hrs or 40.0) or 40.0
        ot_hrs = float(pkg.get("ot_hrs") or 0)
        ot_fte = ot_hrs / avail if avail else 0.0
    xu = float(pkg.get("xu_fte") or 0)
    starts = float(pkg.get("hire_count") or 0)
    if pkg.get("hire_fte") is not None:
        hire = float(pkg.get("hire_fte") or 0)
    else:
        hire = starts * HIRE_YIELD
    return round(ot_fte, 2), round(xu, 2), round(hire, 2)


def package_add_fte(pkg: dict, avail_hrs: float = 40.0) -> float:
    """Total FTE in package (OT + XU + hire), regardless of timing."""
    ot, xu, hire = package_fte_parts(pkg, avail_hrs)
    return round(ot + xu + hire, 2)


def resolve_hire_timing(pkg: dict, plan) -> tuple[int, int, int]:
    """
    Dynamic train/nest weeks from package → plan roster/meta → defaults (2/1).
    Returns (train_wk, nest_wk, lag_wk).
    """
    train = pkg.get("train_wk")
    nest = pkg.get("nest_wk")

    if train is None or nest is None:
        meta = plan.meta if plan else {}
        if train is None:
            train = meta.get("trainWk")
        if nest is None:
            nest = meta.get("nestWk")
        # Prefer first roster class timing when plan has new-hire classes.
        if plan and plan.roster_rows and (train is None or nest is None):
            row = plan.roster_rows[0]
            if train is None:
                train = getattr(row, "training_weeks", None)
            if nest is None:
                nest = getattr(row, "nesting_weeks", None)
            cls_meta = (meta.get("cls") or {}) if isinstance(meta.get("cls"), dict) else {}
            if train is None:
                train = cls_meta.get("trainWk")
            if nest is None:
                nest = cls_meta.get("nestWk")

    train_wk = max(0, int(train if train is not None else 2))
    nest_wk = max(0, int(nest if nest is not None else 1))
    return train_wk, nest_wk, train_wk + nest_wk


def _normalize_donors(raw: list | None) -> list[dict]:
    out: list[dict] = []
    for d in raw or []:
        if isinstance(d, dict):
            cap = d.get("cap_id") or d.get("capId")
            fte = float(d.get("fte") or 0)
            plan = d.get("plan")
        else:
            cap = getattr(d, "cap_id", None)
            fte = float(getattr(d, "fte", 0) or 0)
            plan = getattr(d, "plan", None)
        if not cap or fte <= 0.01:
            continue
        out.append({"cap_id": str(cap), "fte": round(fte, 2), "plan": plan})
    return out


def scale_donors_to_xu(donors: list[dict], target_xu: float) -> list[dict]:
    xu = round(float(target_xu or 0), 2)
    if xu <= 0.01 or not donors:
        return []
    total = sum(float(d["fte"]) for d in donors)
    if total <= 0.01:
        return []
    scale = xu / total
    out = [
        {
            "cap_id": d["cap_id"],
            "fte": round(float(d["fte"]) * scale, 2),
            "plan": d.get("plan"),
        }
        for d in donors
        if float(d["fte"]) * scale > 0.01
    ]
    got = round(sum(d["fte"] for d in out), 2)
    drift = round(xu - got, 2)
    if out and abs(drift) >= 0.01:
        out[0]["fte"] = round(out[0]["fte"] + drift, 2)
    return out


def compute_xutil_donors(plans: list, recip_cap_id: str, target_xu: float) -> list[dict]:
    """Mirror frontend computeXutil; return donor loans for one recipient."""
    donors = []
    for p in plans:
        min_ou = float(p.meta.get("minOUfwd", 0) or 0)
        name = (p.hierarchy.cp_plan_name or "") if p.hierarchy else ""
        if min_ou > 1 and "FE Test" not in name:
            donors.append(
                {
                    "cap_id": p.cap_id,
                    "lend": round(min_ou - 1, 2),
                    "region": getattr(p.hierarchy, "region_name", None) or p.meta.get("region"),
                    "plan": name or p.cap_id,
                }
            )
    recips = []
    for p in plans:
        sustained = float(p.meta.get("sustained", 0) or 0)
        if sustained < -0.5:
            recips.append(
                {
                    "cap_id": p.cap_id,
                    "need": round(-sustained, 2),
                    "got": 0.0,
                    "donors": [],
                    "region": getattr(p.hierarchy, "region_name", None) or p.meta.get("region"),
                }
            )
    recips.sort(key=lambda r: r["need"], reverse=True)
    donors.sort(key=lambda d: d["lend"], reverse=True)

    for r in recips:
        rem = r["need"]
        for pass_i in (0, 1):
            for d in donors:
                if d["lend"] <= 0.01 or rem <= 0.01:
                    continue
                same = d.get("region") == r.get("region")
                if pass_i == 0 and not same:
                    continue
                if pass_i == 1 and same:
                    continue
                amt = round(min(d["lend"], rem), 2)
                if amt <= 0.01:
                    continue
                d["lend"] = round(d["lend"] - amt, 2)
                rem = round(rem - amt, 2)
                r["got"] = round(r["got"] + amt, 2)
                r["donors"].append({"cap_id": d["cap_id"], "fte": amt, "plan": d["plan"]})

    match = next((r for r in recips if r["cap_id"] == recip_cap_id), None)
    if not match:
        return []
    return scale_donors_to_xu(match["donors"], target_xu)


async def adjust_plan_fte(
    session: AsyncSession,
    cap_id: str,
    delta_fte: float,
    *,
    start_offset: int = 0,
    update_closing: bool = True,
) -> dict:
    """Add (or subtract) FTE on forward projected weeks from curIdx+start_offset."""
    plan = await load_plan(session, cap_id)
    if not plan:
        return {"cap_id": cap_id, "delta_fte": 0.0, "skipped": True, "reason": "plan_not_found"}

    delta = round(float(delta_fte or 0), 2)
    if abs(delta) < 0.01:
        return {"cap_id": cap_id, "delta_fte": 0.0, "skipped": True, "reason": "zero_delta"}

    cp_plan_id = cap_to_cp(cap_id)
    cur_idx = int(plan.meta.get("curIdx", 0))
    apply_from = cur_idx + max(0, int(start_offset or 0))

    for idx, week_date in enumerate(plan.week_dates):
        if idx < apply_from:
            continue
        proj_row = (
            await session.execute(
                select(OneviewPlannerDataset).where(
                    OneviewPlannerDataset.cp_plan_id == cp_plan_id,
                    OneviewPlannerDataset.date == week_date,
                    OneviewPlannerDataset.kpi_key == KPI_PROJ,
                )
            )
        ).scalar_one_or_none()
        ou_row = (
            await session.execute(
                select(OneviewPlannerDataset).where(
                    OneviewPlannerDataset.cp_plan_id == cp_plan_id,
                    OneviewPlannerDataset.date == week_date,
                    OneviewPlannerDataset.kpi_key == KPI_OU,
                )
            )
        ).scalar_one_or_none()
        if proj_row:
            proj_row.value = float(proj_row.value or 0) + delta
            plan.projected[idx] = float(proj_row.value)
        if ou_row:
            ou_row.value = plan.projected[idx] - plan.required[idx]
            plan.ou[idx] = float(ou_row.value)
        elif idx < len(plan.ou):
            plan.ou[idx] = plan.projected[idx] - plan.required[idx]

    fwd_ou = [float(v) for v in plan.ou[cur_idx : cur_idx + 12] if v is not None]
    sustained = round(sum(fwd_ou) / len(fwd_ou), 2) if fwd_ou else float(plan.meta.get("sustained", 0) or 0)
    min_ou = round(min(fwd_ou), 2) if fwd_ou else float(plan.meta.get("minOUfwd", 0) or 0)

    meta_patch: dict = {
        "sustained": sustained,
        "minOUfwd": min_ou,
        "ou": round(float(plan.ou[cur_idx]) if cur_idx < len(plan.ou) else sustained, 2),
    }
    closing = float(plan.meta.get("closingFTE", 0) or 0)

    if update_closing:
        hc_base = None
        if plan.headcount and plan.headcount.get("closing") is not None:
            hc_base = float(plan.headcount.get("closing") or 0)
        meta_closing = float(plan.meta.get("closingFTE", 0) or 0)
        base_closing = hc_base if hc_base is not None else meta_closing
        closing = round(base_closing + delta, 2)

        if plan.week_dates and 0 <= cur_idx < len(plan.week_dates):
            cur_date = plan.week_dates[cur_idx]
            hc_row = (
                await session.execute(
                    select(OneviewHeaderDetails).where(
                        OneviewHeaderDetails.cp_plan_id == cp_plan_id,
                        OneviewHeaderDetails.date == cur_date,
                        OneviewHeaderDetails.dataset_type == "Headcount",
                        OneviewHeaderDetails.ref_code == "closing",
                    )
                )
            ).scalar_one_or_none()
            if hc_row:
                hc_row.value = closing

        hc_cur = dict(plan.meta.get("hcCur") or {})
        if plan.headcount:
            for api_key, meta_key in (
                ("opening", "opening"),
                ("nest", "nest"),
                ("tin", "tin"),
                ("tout", "tout"),
                ("loa_in", "loaIn"),
                ("loa_out", "loaOut"),
                ("attr", "attr"),
                ("promo", "promo"),
                ("closing", "closing"),
            ):
                if api_key in plan.headcount and meta_key not in hc_cur:
                    hc_cur[meta_key] = float(plan.headcount[api_key] or 0)
        hc_cur["closing"] = closing
        meta_patch["closingFTE"] = closing
        meta_patch["hcCur"] = hc_cur

    await update_plan_meta(session, cap_id, meta_patch)
    return {
        "cap_id": cap_id,
        "delta_fte": delta,
        "skipped": False,
        "sustained": sustained,
        "min_ou_fwd": min_ou,
        "closing_fte": closing,
        "start_offset": apply_from - cur_idx,
    }


async def create_hire_roster_class(
    session: AsyncSession,
    plan,
    *,
    hire_count: float,
    train_wk: int,
    nest_wk: int,
    hire_lag: int,
    package_id: int | None = None,
) -> dict:
    """
    Create a New Hire class for executed staffing hire (dynamic dates from plan weeks).
    Does not re-add projected FTE — that is handled by adjust_plan_fte with lag.
    """
    starts = float(hire_count or 0)
    if starts < 0.01 or not plan:
        return {"created": False}

    cap_id = plan.cap_id
    cp_plan_id = cap_to_cp(cap_id)
    cur_idx = int(plan.meta.get("curIdx", 0))
    week_dates = plan.week_dates or []
    if not week_dates:
        return {"created": False, "reason": "no_weeks"}

    start_date = week_dates[cur_idx] if 0 <= cur_idx < len(week_dates) else week_dates[0]
    train_start = start_date
    nest_start = start_date + timedelta(weeks=max(0, train_wk))
    prod_idx = cur_idx + max(0, hire_lag)
    if 0 <= prod_idx < len(week_dates):
        prod_start = week_dates[prod_idx]
    else:
        prod_start = nest_start + timedelta(weeks=max(0, nest_wk))

    class_ref = f"EXEC-HIRE-{cap_id}-{start_date.isoformat()}"
    if package_id is not None:
        class_ref = f"EXEC-HIRE-{cap_id}-P{package_id}"

    # Upsert by class_reference so re-execute / re-accept stays idempotent per package.
    existing = (
        await session.execute(
            select(OneviewNewHire).where(
                OneviewNewHire.capability_id == cap_id,
                OneviewNewHire.class_reference == class_ref,
            )
        )
    ).scalar_one_or_none()

    if existing:
        existing.plan_hc = starts
        existing.actual_hc = starts
        existing.new_hires = starts
        existing.training_weeks = train_wk
        existing.nesting_weeks = nest_wk
        existing.training_start_date = train_start
        existing.nesting_start_date = nest_start
        existing.production_start_date = prod_start
        existing.class_status = "planned"
        row = existing
    else:
        row = OneviewNewHire(
            capability_id=cap_id,
            source_id=cp_plan_id,
            cp_plan_id=cp_plan_id,
            class_reference=class_ref,
            class_status="planned",
            class_type="Training",
            induction_date=start_date - timedelta(days=7),
            planned_start_date=start_date,
            training_start_date=train_start,
            nesting_start_date=nest_start,
            production_start_date=prod_start,
            training_weeks=train_wk,
            nesting_weeks=nest_wk,
            plan_hc=starts,
            actual_hc=starts,
            graduate_needed=0.0,
            billable_hc=0.0,
            non_billable_hc=starts,
            new_hires=starts,
            original_plan_hc=starts,
            fixed_flexi_hours_status="Fixed Hours",
        )
        session.add(row)

    n = len(plan.week_labels)
    s_hire = list(plan.meta.get("sHire") or [0.0] * n)
    if len(s_hire) < n:
        s_hire = list(s_hire) + [0.0] * (n - len(s_hire))
    s_hire = [float(v or 0) for v in s_hire[:n]]
    # Stamp planned starts on current week; production FTE already lands at lag in projected.
    if 0 <= cur_idx < n:
        s_hire[cur_idx] = round(float(s_hire[cur_idx] or 0) + starts, 2)

    meta_cls = {
        **(plan.meta.get("cls") or {}),
        "className": class_ref,
        "status": "planned",
        "plan": starts,
        "actual": starts,
        "trainHC": starts,
        "trainWk": train_wk,
        "nestWk": nest_wk,
        "date": start_date.isoformat(),
        "source": "staffing_execute",
    }
    await update_plan_meta(
        session,
        cap_id,
        {
            "cls": meta_cls,
            "hire12": starts if existing else float(plan.meta.get("hire12") or 0) + starts,
            "sHire": s_hire,
            "trainWk": train_wk,
            "nestWk": nest_wk,
        },
    )
    await session.flush()
    return {
        "created": True,
        "class_id": row.id,
        "class_reference": class_ref,
        "plan_hc": starts,
        "train_wk": train_wk,
        "nest_wk": nest_wk,
        "production_start": prod_start.isoformat(),
    }


async def resolve_package_donors(session: AsyncSession, pkg: dict) -> list[dict]:
    """Use stored donors, or recompute from portfolio if xu > 0 and list empty."""
    xu = float(pkg.get("xu_fte") or 0)
    stored = scale_donors_to_xu(_normalize_donors(pkg.get("donors")), xu)
    if stored or xu <= 0.01:
        return stored
    plans = await load_all_plans(session)
    return compute_xutil_donors(plans, pkg.get("cap_id"), xu)


async def apply_staffing_package(session: AsyncSession, pkg: dict) -> dict:
    """
    Credit recipient: OT+XU immediate; hire after train+nest lag.
    Debit donor plans for XU loans (immediate).
    Idempotent via pkg['staffing_applied'].
    """
    cap_id = pkg.get("cap_id")
    if not cap_id:
        return {"cap_id": None, "added_fte": 0.0, "skipped": True, "reason": "missing_cap"}

    if pkg.get("staffing_applied"):
        return {
            "cap_id": cap_id,
            "added_fte": float(pkg.get("applied_fte") or 0),
            "skipped": True,
            "reason": "already_applied",
            "donors_debited": pkg.get("donors_debited") or [],
        }

    plan = await load_plan(session, cap_id)
    if not plan:
        return {"cap_id": cap_id, "added_fte": 0.0, "skipped": True, "reason": "plan_not_found"}

    avail = float(plan.meta.get("availHrs", 40) or 40)
    ot_fte, xu_fte, hire_fte = package_fte_parts(pkg, avail)
    immediate = round(ot_fte + xu_fte, 2)
    add_fte = round(immediate + hire_fte, 2)
    train_wk, nest_wk, hire_lag = resolve_hire_timing(pkg, plan)
    pkg["train_wk"] = train_wk
    pkg["nest_wk"] = nest_wk
    pkg["hire_lag_wk"] = hire_lag

    donors = await resolve_package_donors(session, pkg)
    pkg["donors"] = donors

    if abs(add_fte) < 0.01 and not donors:
        pkg["staffing_applied"] = True
        pkg["applied_fte"] = 0.0
        pkg["donors_debited"] = []
        return {"cap_id": cap_id, "added_fte": 0.0, "skipped": False, "reason": "zero_fte"}

    recip = {
        "cap_id": cap_id,
        "delta_fte": 0.0,
        "skipped": True,
        "sustained": float(plan.meta.get("sustained", 0) or 0),
        "min_ou_fwd": float(plan.meta.get("minOUfwd", 0) or 0),
    }

    if abs(immediate) >= 0.01:
        recip = await adjust_plan_fte(
            session, cap_id, immediate, start_offset=0, update_closing=True
        )

    if abs(hire_fte) >= 0.01:
        # Hire lands only after train + nest; do not bump today's Closing FTE.
        hire_res = await adjust_plan_fte(
            session,
            cap_id,
            hire_fte,
            start_offset=hire_lag,
            update_closing=False,
        )
        # Reload plan so roster create sees latest meta weeks.
        plan = await load_plan(session, cap_id) or plan
        roster_info = await create_hire_roster_class(
            session,
            plan,
            hire_count=float(pkg.get("hire_count") or 0),
            train_wk=train_wk,
            nest_wk=nest_wk,
            hire_lag=hire_lag,
            package_id=int(pkg["id"]) if pkg.get("id") is not None else None,
        )
        recip = {
            **recip,
            "sustained": hire_res.get("sustained", recip.get("sustained")),
            "min_ou_fwd": hire_res.get("min_ou_fwd", recip.get("min_ou_fwd")),
            "hire_offset": hire_lag,
            "hire_fte": hire_fte,
            "roster_class": roster_info,
        }

    donors_debited: list[dict] = []
    for d in donors:
        if d["cap_id"] == cap_id:
            continue
        result = await adjust_plan_fte(
            session, d["cap_id"], -float(d["fte"]), start_offset=0, update_closing=True
        )
        donors_debited.append(
            {
                "cap_id": d["cap_id"],
                "fte": float(d["fte"]),
                "plan": d.get("plan"),
                "sustained": result.get("sustained"),
                "skipped": result.get("skipped", False),
            }
        )

    await update_plan_meta(
        session,
        cap_id,
        {
            "lastStaffingPackage": {
                "ot_hrs": float(pkg.get("ot_hrs") or 0),
                "ot_fte": ot_fte,
                "xu_fte": xu_fte,
                "hire_count": int(pkg.get("hire_count") or 0),
                "hire_fte": hire_fte,
                "train_wk": train_wk,
                "nest_wk": nest_wk,
                "hire_lag_wk": hire_lag,
                "immediate_fte": immediate,
                "added_fte": add_fte,
                "donors": donors,
                "roster_class": recip.get("roster_class"),
            },
        },
    )

    pkg["staffing_applied"] = True
    pkg["applied_fte"] = add_fte
    pkg["donors_debited"] = donors_debited
    return {
        "cap_id": cap_id,
        "added_fte": add_fte,
        "immediate_fte": immediate,
        "hire_fte": hire_fte,
        "hire_lag_wk": hire_lag,
        "train_wk": train_wk,
        "nest_wk": nest_wk,
        "skipped": False,
        "sustained": recip.get("sustained"),
        "min_ou_fwd": recip.get("min_ou_fwd"),
        "donors_debited": donors_debited,
        "donor_fte": round(sum(float(d["fte"]) for d in donors_debited), 2),
        "roster_class": recip.get("roster_class"),
    }
