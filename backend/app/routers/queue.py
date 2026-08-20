from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas import (
    ActionPackageOut,
    ActionPackagePatch,
    ExecuteQueueRequest,
    ExecuteQueueResponse,
)
from app.services.demo_store import DEMO_ACTION_PACKAGES, get_json_setting, set_json_setting
from app.services.plan_repository import load_plan

router = APIRouter(prefix="/queue", tags=["queue"])


async def _packages(session: AsyncSession) -> list[dict]:
    return await get_json_setting(session, DEMO_ACTION_PACKAGES, [])


async def _save_packages(session: AsyncSession, packages: list[dict]) -> None:
    await set_json_setting(session, DEMO_ACTION_PACKAGES, packages)


async def _package_out(session: AsyncSession, pkg: dict) -> ActionPackageOut:
    plan = await load_plan(session, pkg["cap_id"])
    plan_name = plan.hierarchy.cp_plan_name if plan else None
    return ActionPackageOut(
        id=int(pkg["id"]),
        cap_id=pkg["cap_id"],
        ot_hrs=float(pkg["ot_hrs"]),
        xu_fte=float(pkg["xu_fte"]),
        hire_count=int(pkg["hire_count"]),
        status=pkg["status"],
        description=pkg["description"],
        plan_name=plan_name,
    )


@router.get("/packages", response_model=list[ActionPackageOut])
async def list_packages(session: AsyncSession = Depends(get_db)):
    packages = await _packages(session)
    return [await _package_out(session, p) for p in packages]


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
    for pkg in selected:
        if pkg["status"] != "posted":
            pkg["status"] = "posted"
            posted.append(int(pkg["id"]))

    await _save_packages(session, packages)
    await session.commit()
    return ExecuteQueueResponse(
        posted=posted,
        message=f"Posted {len(posted)} package(s) to CAP-ABILITY",
    )
