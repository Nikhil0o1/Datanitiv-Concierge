from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas import (
    ActionPackageOut,
    ActionPackagePatch,
    ActionPackageUpsert,
    ExecuteQueueRequest,
    ExecuteQueueResponse,
)
from app.services.demo_store import DEMO_ACTION_PACKAGES, get_json_setting, set_json_setting
from app.services.plan_repository import load_plan
from app.services.staffing_apply import apply_staffing_package

router = APIRouter(prefix="/queue", tags=["queue"])


async def _packages(session: AsyncSession) -> list[dict]:
    return await get_json_setting(session, DEMO_ACTION_PACKAGES, [])


async def _save_packages(session: AsyncSession, packages: list[dict]) -> None:
    await set_json_setting(session, DEMO_ACTION_PACKAGES, packages)


async def _package_out(session: AsyncSession, pkg: dict) -> ActionPackageOut:
    plan = await load_plan(session, pkg["cap_id"])
    plan_name = plan.hierarchy.cp_plan_name if plan else None
    donors = [
        {"cap_id": d.get("cap_id"), "fte": float(d.get("fte") or 0), "plan": d.get("plan")}
        for d in (pkg.get("donors") or [])
        if d.get("cap_id")
    ]
    train_wk = int(pkg.get("train_wk") if pkg.get("train_wk") is not None else 2)
    nest_wk = int(pkg.get("nest_wk") if pkg.get("nest_wk") is not None else 1)
    hire_lag = int(pkg.get("hire_lag_wk") if pkg.get("hire_lag_wk") is not None else train_wk + nest_wk)
    return ActionPackageOut(
        id=int(pkg["id"]),
        cap_id=pkg["cap_id"],
        ot_hrs=float(pkg["ot_hrs"]),
        xu_fte=float(pkg["xu_fte"]),
        hire_count=int(pkg["hire_count"]),
        status=pkg["status"],
        description=pkg["description"],
        plan_name=plan_name,
        staffing_applied=bool(pkg.get("staffing_applied")),
        applied_fte=float(pkg["applied_fte"]) if pkg.get("applied_fte") is not None else None,
        donors=donors,
        train_wk=train_wk,
        nest_wk=nest_wk,
        hire_lag_wk=hire_lag,
    )


@router.get("/packages", response_model=list[ActionPackageOut])
async def list_packages(session: AsyncSession = Depends(get_db)):
    packages = await _packages(session)
    return [await _package_out(session, p) for p in packages]


@router.post("/packages/upsert", response_model=ActionPackageOut)
async def upsert_package(body: ActionPackageUpsert, session: AsyncSession = Depends(get_db)):
    """Create or update a queued package from the live Recommend accept."""
    packages = await _packages(session)
    pkg = next((p for p in packages if p.get("cap_id") == body.cap_id and p.get("status") != "posted"), None)
    if not pkg:
        pkg = next((p for p in packages if p.get("cap_id") == body.cap_id), None)

    next_id = max((int(p.get("id") or 0) for p in packages), default=0) + 1
    donors = [
        {"cap_id": d.cap_id, "fte": float(d.fte), "plan": d.plan}
        for d in (body.donors or [])
        if d.cap_id and float(d.fte) > 0
    ]
    # Resolve train/nest dynamically from request or live plan defaults.
    plan = await load_plan(session, body.cap_id)
    train_wk = body.train_wk
    nest_wk = body.nest_wk
    if plan is not None:
        from app.services.staffing_apply import resolve_hire_timing

        train_wk, nest_wk, hire_lag = resolve_hire_timing(
            {"train_wk": train_wk, "nest_wk": nest_wk},
            plan,
        )
    else:
        train_wk = int(train_wk if train_wk is not None else 2)
        nest_wk = int(nest_wk if nest_wk is not None else 1)
        hire_lag = train_wk + nest_wk

    donor_note = ""
    if donors:
        donor_note = " from " + ", ".join(
            f"{d['cap_id']}({d['fte']:.2f})" for d in donors[:4]
        )
        if len(donors) > 4:
            donor_note += f" +{len(donors) - 4} more"
    hire_note = ""
    if body.hire_count > 0:
        hire_note = f" · hire {body.hire_count} (prod +{hire_lag}wk)"
    else:
        hire_note = " · hire 0"
    desc = body.description or (
        f"OT {body.ot_hrs:.2f} hrs/wk · loan {body.xu_fte:.2f} FTE{donor_note}{hire_note} · accepted"
    )

    if pkg and pkg.get("staffing_applied"):
        # Prior apply already landed — open a fresh queued package for a new accept.
        pkg = None

    if pkg is None:
        pkg = {
            "id": next_id,
            "cap_id": body.cap_id,
            "ot_hrs": float(body.ot_hrs),
            "ot_fte": float(body.ot_fte) if body.ot_fte is not None else None,
            "xu_fte": float(body.xu_fte),
            "hire_count": int(body.hire_count),
            "train_wk": train_wk,
            "nest_wk": nest_wk,
            "hire_lag_wk": hire_lag,
            "donors": donors,
            "status": "queued",
            "description": desc,
            "staffing_applied": False,
        }
        packages.append(pkg)
    else:
        pkg["ot_hrs"] = float(body.ot_hrs)
        pkg["ot_fte"] = float(body.ot_fte) if body.ot_fte is not None else None
        pkg["xu_fte"] = float(body.xu_fte)
        pkg["hire_count"] = int(body.hire_count)
        pkg["train_wk"] = train_wk
        pkg["nest_wk"] = nest_wk
        pkg["hire_lag_wk"] = hire_lag
        pkg["donors"] = donors
        pkg["description"] = desc
        pkg["status"] = "queued"
        pkg["staffing_applied"] = False
        pkg.pop("applied_fte", None)
        pkg.pop("donors_debited", None)

    await _save_packages(session, packages)
    await session.commit()
    return await _package_out(session, pkg)


@router.patch("/packages/{package_id}", response_model=ActionPackageOut)
async def patch_package(
    package_id: int,
    body: ActionPackagePatch,
    session: AsyncSession = Depends(get_db),
):
    packages = await _packages(session)
    pkg = next((p for p in packages if int(p["id"]) == package_id), None)
    if not pkg:
        raise HTTPException(status_code=404, detail="Package not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        pkg[field] = value

    await _save_packages(session, packages)
    await session.commit()
    return await _package_out(session, pkg)


@router.post("/execute", response_model=ExecuteQueueResponse)
async def execute_queue(body: ExecuteQueueRequest, session: AsyncSession = Depends(get_db)):
    if not body.package_ids:
        raise HTTPException(status_code=400, detail="No packages selected")

    packages = await _packages(session)
    selected = [p for p in packages if int(p["id"]) in body.package_ids]
    if len(selected) != len(body.package_ids):
        raise HTTPException(status_code=404, detail="One or more packages not found")

    posted: list[int] = []
    applied: list[dict] = []
    for pkg in selected:
        result = await apply_staffing_package(session, pkg)
        applied.append(result)
        if pkg["status"] != "posted":
            pkg["status"] = "posted"
            posted.append(int(pkg["id"]))
        else:
            posted.append(int(pkg["id"]))

    await _save_packages(session, packages)
    await session.commit()

    added = sum(float(a.get("added_fte") or 0) for a in applied if not a.get("skipped"))
    immediate = sum(float(a.get("immediate_fte") or 0) for a in applied if not a.get("skipped"))
    hire_fte = sum(float(a.get("hire_fte") or 0) for a in applied if not a.get("skipped"))
    donor_fte = sum(float(a.get("donor_fte") or 0) for a in applied if not a.get("skipped"))
    skipped = sum(1 for a in applied if a.get("skipped"))
    lags = [int(a["hire_lag_wk"]) for a in applied if not a.get("skipped") and float(a.get("hire_fte") or 0) > 0.01]
    msg = f"Posted {len(posted)} package(s) · +{immediate:.2f} FTE now"
    if hire_fte > 0.01:
        lag = lags[0] if lags else 3
        msg += f" · +{hire_fte:.2f} hire FTE from week +{lag}"
        rostered = sum(
            1
            for a in applied
            if not a.get("skipped") and (a.get("roster_class") or {}).get("created")
        )
        if rostered:
            msg += f" · {rostered} new-hire class(es) created"
    if donor_fte > 0.01:
        msg += f" · debited −{donor_fte:.2f} FTE from donor(s)"
    if skipped:
        msg += f" ({skipped} already applied / skipped)"

    return ExecuteQueueResponse(
        posted=posted,
        message=msg,
        applied=applied,
    )
