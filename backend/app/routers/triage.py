from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas import TriagePlanItem, TriageResponse
from app.services.plan_helpers import _has_roster_gap, plan_to_triage_dict
from app.services.plan_repository import load_all_plans
from app.services.triage import triage_plans

router = APIRouter(tags=["triage"])


@router.get("/triage", response_model=TriageResponse)
async def get_triage(session: AsyncSession = Depends(get_db)):
    plans = await load_all_plans(session)
    triage_dicts = [plan_to_triage_dict(p) for p in plans]
    result = triage_plans(triage_dicts)

    def to_item(item) -> TriagePlanItem:
        p = item.plan
        plan_loaded = next((x for x in plans if x.cap_id == p["capId"]), None)
        return TriagePlanItem(
            cap_id=p["capId"],
            plan_name=p["plan"],
            program=p["program"],
            lob=p["lob"],
            site=p["site"].rstrip("-") if p.get("site") else "",
            sustained=p["sustained"],
            min_ou_fwd=p.get("minOUfwd", 0),
            why=item.why,
            tag=item.tag,
            tag_class=item.tag_class,
            has_roster_gap=_has_roster_gap(plan_loaded) if plan_loaded else False,
        )

    dec = [to_item(i) for i in result["dec"]]
    auto = [to_item(i) for i in result["auto"]]
    quiet = [to_item(i) for i in result["quiet"]]

    return TriageResponse(
        dec=dec,
        auto=auto,
        quiet=quiet,
        counts={"dec": len(dec), "auto": len(auto), "quiet": len(quiet), "total": len(plans)},
    )
