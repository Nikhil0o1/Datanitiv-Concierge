"""Parse prototype.html DATA and seed every Cape / pgBoss table with demo data."""

from __future__ import annotations

import json
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AppSetting,
    CapeChatMessage,
    CapeChatSession,
    CapeRecommendationThresholds,
    CapeReminder,
    OneviewAttritionAssumption,
    OneviewBudget,
    OneviewHeaderDetails,
    OneviewHierarchy,
    OneviewNewHire,
    OneviewPlannerDataset,
    OneviewRosterLog,
    OneviewRosterRole,
    OneviewRosterSummary,
    OneviewRosterWorkStatus,
    OneviewShrinkage,
    OneviewTitleTranslation,
    SchemaMigration,
)
from app.services.demo_store import (
    DEMO_ACTION_PACKAGES,
    DEMO_AGENT_MEMORIES,
    DEMO_PLAN_META,
    DEMO_PLANNING_CYCLE,
    DEMO_TIME_LEDGER,
    set_json_setting,
)
from app.services.plan_repository import cap_to_cp, compute_closing_fte, week_dates_from_labels

PROTOTYPE_PATH = Path(__file__).resolve().parents[3] / "prototype.html"
ENRICHMENT_PATH = Path(__file__).resolve().parents[3] / "frontend" / "src" / "data" / "htmlPlanEnrichment.json"
NOW = datetime.now(timezone.utc)

TITLE_TRANSLATIONS = [
    (1, "Date", "Date", "CpPlandataset", "date"),
    (2, "PlanStartDay", "Start Day Of Plan", "CpPlandataset", "text"),
    (3, "Planner", "Planner", "CpPlandataset", "text"),
    (10, "Billable_FTE_Projected", "Billable FTE Projected", "CpPlandataset", "number"),
    (13, "Billable_FTE_Required", "Net FTE Required", "CpPlandataset", "number"),
    (19, "FTE_Over_Under", "FTE Over Under", "CpPlandataset", "number"),
]

ATTRITION_STAGES = ("Training", "Nesting", "Production")


def parse_prototype_data(html_path: Path | None = None) -> list[dict]:
    path = html_path or PROTOTYPE_PATH
    content = path.read_text(encoding="utf-8")
    match = re.search(r"var\s+DATA\s*=\s*(\[.*?\]);", content, re.DOTALL)
    if not match:
        raise ValueError(f"Could not find DATA array in {path}")
    return json.loads(match.group(1))


def _enrichment_map() -> dict[str, dict]:
    if not ENRICHMENT_PATH.exists():
        return {}
    try:
        rows = json.loads(ENRICHMENT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {row["capId"]: row for row in rows if row.get("capId")}


def _class_name(cap_id: str) -> str:
    return f"TC_2026_{cap_id.replace('CAP', '')}"


def _scope(row: dict) -> dict:
    return {
        "capability_id": row["capId"],
        "organization": "Demo Org",
        "business_entity": row.get("vertical", ""),
        "vertical": row.get("vertical", ""),
        "program": row["program"],
        "lob": row["lob"],
        "sub_lob": row["lob"],
        "activity": row["plan"],
        "site": row["site"],
    }


def _parse_cls_date(label: str, year: int = 2026) -> date | None:
    if not label or "/" not in str(label):
        return None
    parts = [p for p in str(label).strip().split("/") if p]
    try:
        if len(parts) == 2:
            month, day = map(int, parts)
            return date(year, month, day)
        if len(parts) == 3:
            month, day, raw_year = map(int, parts)
            if raw_year < 100:
                raw_year += 2000
            return date(raw_year, month, day)
    except ValueError:
        return None
    return None


def _normalize_hc(hc_meta: dict | None) -> dict | None:
    if not hc_meta:
        return None
    hc = {
        "opening": float(hc_meta.get("opening") or 0),
        "nest": float(hc_meta.get("nest") or 0),
        "tin": float(hc_meta.get("tin") or 0),
        "tout": float(hc_meta.get("tout") or 0),
        "loaIn": float(hc_meta.get("loaIn") or hc_meta.get("loa_in") or 0),
        "loaOut": float(hc_meta.get("loaOut") or hc_meta.get("loa_out") or 0),
        "attr": float(hc_meta.get("attr") or 0),
        "promo": float(hc_meta.get("promo") or 0),
        "closing": 0.0,
    }
    hc["closing"] = compute_closing_fte(hc)
    return hc


def _add_hc_rows(session, *, cp_plan_id: int, week_date, hc: dict, scope: dict) -> None:
    for ref_code, value in hc.items():
        session.add(
            OneviewHeaderDetails(
                cp_plan_id=cp_plan_id,
                dataset_type="Headcount",
                date=week_date,
                ref_code=ref_code,
                kpi_group="Headcount",
                type="Headcount",
                sub_type=ref_code,
                title=ref_code,
                title_type="Actual",
                unit="FTE",
                value=float(value),
                is_billable=True,
                last_updated_on_utc=NOW.replace(tzinfo=None),
                **scope,
            )
        )


def _roster_id(cp_plan_id: int) -> int:
    return 10_000 + cp_plan_id


async def seed_database(session: AsyncSession, html_path: Path | None = None) -> dict[str, int]:
    if (await session.execute(select(OneviewHierarchy).limit(1))).scalar_one_or_none():
        return {"skipped": True}

    data = parse_prototype_data(html_path)
    enrichment = _enrichment_map()
    counts: dict[str, int] = {}

    for tid, actual, display, source, col_type in TITLE_TRANSLATIONS:
        session.add(
            OneviewTitleTranslation(
                id=tid,
                actual_name=actual,
                display_name=display,
                translated_name=display,
                source_table_name=source,
                column_type=col_type,
            )
        )
    counts["oneview_title_translation"] = len(TITLE_TRANSLATIONS)

    plan_meta: dict[str, dict] = {}
    demo_planner = data[0].get("planner", "Demo Planner")

    for row in data:
        cap_id = row["capId"]
        extra = enrichment.get(cap_id) or {}
        cp_plan_id = cap_to_cp(cap_id)
        weeks = row.get("weeks") or []
        dates = week_dates_from_labels(weeks) if weeks else []
        scope = _scope(row)
        cur_idx = int(row.get("curIdx", 0))
        cur_date = dates[cur_idx] if dates and 0 <= cur_idx < len(dates) else None
        billable = 50.0
        map_id = cp_plan_id
        activity_id = cp_plan_id
        hc_cur = _normalize_hc(row.get("hcCur") or extra.get("hcCur"))
        hc_last = _normalize_hc(extra.get("hcLast"))
        seed_close = float(row.get("closingFTE") or (hc_cur or {}).get("closing") or 0)
        computed_close = float((hc_cur or {}).get("closing") or seed_close)
        proj_delta = round(computed_close - seed_close, 2) if hc_cur else 0.0

        session.add(
            OneviewHierarchy(
                cp_plan_id=cp_plan_id,
                capability_id=cap_id,
                cp_plan_name=row["plan"],
                cp_plan_start_date=dates[0] if dates else None,
                cp_plan_end_date=dates[-1] if dates else None,
                cp_plan_type_id=1,
                cp_plan_type="FTE" if "FTE" in row["plan"] else "Hours",
                first_day_of_week="Sunday",
                map_activity_id=cp_plan_id,
                map_id=map_id,
                organization_id=1,
                business_entity_id=1,
                vertical_id=1,
                program_id=cp_plan_id,
                lob_id=cp_plan_id,
                sub_lob_id=cp_plan_id,
                activity_id=activity_id,
                partner_id=1,
                site_id=cp_plan_id,
                location_id=cp_plan_id,
                country_id=1,
                region_id=1,
                organization_name="Demo Org",
                business_entity_name=row.get("vertical", ""),
                vertical_name=row.get("vertical", ""),
                program_name=row["program"],
                lob_name=row["lob"],
                sub_lob_name=row["lob"],
                activity_name=row["plan"],
                partner_name="Demo Partner",
                site_name=row["site"],
                location_name=row["site"].rstrip("-"),
                country_name=row.get("region", ""),
                region_name=row.get("region", ""),
                is_captive=1,
                hierarchy=f"{row['program']} / {row['lob']} / {row['site']}",
                planner=row.get("planner", ""),
                manager=row.get("planner", ""),
                director="Demo Director",
            )
        )

        s_ou = row.get("sOU") or []
        s_proj = row.get("sProj") or []
        s_req = row.get("sReq") or []
        s_shrink = row.get("sShrink") or []
        s_shrink_plan = row.get("sShrinkPlan") or []
        ou_now = round(float(s_ou[cur_idx] if cur_idx < len(s_ou) else row.get("ou", 0)) + proj_delta, 2)
        fwd_ou = [round(float(s_ou[i] or 0) + proj_delta, 2) for i in range(cur_idx, min(len(s_ou), cur_idx + 12))]
        sustained_live = round(sum(fwd_ou) / len(fwd_ou), 2) if fwd_ou else float(row.get("sustained", 0))
        min_ou_live = round(min(fwd_ou), 2) if fwd_ou else float(row.get("minOUfwd", 0))

        for idx, week_date in enumerate(dates):
            for kpi_key, series in (
                ("FTE_Over_Under", s_ou),
                ("Billable_FTE_Projected", s_proj),
                ("Billable_FTE_Required", s_req),
            ):
                value = float(series[idx] if idx < len(series) else 0.0)
                if proj_delta and idx >= cur_idx and kpi_key in ("FTE_Over_Under", "Billable_FTE_Projected"):
                    value = round(value + proj_delta, 2)
                session.add(
                    OneviewPlannerDataset(
                        cp_plan_id=cp_plan_id,
                        date=week_date,
                        kpi_key=kpi_key,
                        value=value,
                        last_updated_on_utc=NOW.replace(tzinfo=None),
                        **scope,
                    )
                )

            for title_type, pct, series in (
                ("Actual", s_shrink[idx] if idx < len(s_shrink) else None, s_shrink),
                ("Plan", s_shrink_plan[idx] if idx < len(s_shrink_plan) else None, s_shrink_plan),
            ):
                if pct is None:
                    continue
                pct_f = float(pct)
                session.add(
                    OneviewShrinkage(
                        cp_plan_id=cp_plan_id,
                        date=week_date,
                        shrinkage_type="Total",
                        shrinkage_subtype="All",
                        segment="All",
                        title_type=title_type,
                        percent_value=pct_f,
                        hours_value=round(billable * (pct_f / 100.0) * 40.0, 2),
                        is_billable=True,
                        is_hide=False,
                        is_nesting=False,
                        last_updated_on_utc=NOW.replace(tzinfo=None),
                        **scope,
                    )
                )

        if cur_date:
            hc = hc_cur or {}
            if hc:
                _add_hc_rows(session, cp_plan_id=cp_plan_id, week_date=cur_date, hc=hc, scope=scope)
            prev_date = dates[cur_idx - 1] if dates and cur_idx > 0 else None
            if prev_date and hc_last:
                _add_hc_rows(session, cp_plan_id=cp_plan_id, week_date=prev_date, hc=hc_last, scope=scope)

            for ref_code, value, unit in (
                ("ou", ou_now, "FTE"),
                ("sustained", sustained_live, "FTE"),
                ("minOUfwd", min_ou_live, "FTE"),
                ("closingFTE", computed_close, "FTE"),
                ("shrink12", row.get("shrink12", 0), "Pct"),
                ("attr12", extra.get("attr12", row.get("attr12", 0)), "Pct"),
                ("availHrs", extra.get("availHrs", row.get("availHrs", 40)), "Hours"),
            ):
                session.add(
                    OneviewHeaderDetails(
                        cp_plan_id=cp_plan_id,
                        dataset_type="Summary",
                        date=cur_date,
                        ref_code=ref_code,
                        kpi_group="Summary",
                        type="KPI",
                        sub_type=ref_code,
                        title=ref_code,
                        title_type="Actual",
                        unit=unit,
                        value=float(value),
                        last_updated_on_utc=NOW.replace(tzinfo=None),
                        **scope,
                    )
                )

            session.add(
                OneviewBudget(
                    capability_id=cap_id,
                    cp_plan_id=cp_plan_id,
                    ref_code="closing_fte",
                    title="Closing FTE",
                    date=cur_date,
                    value=float(computed_close),
                    unit="FTE",
                )
            )
            session.add(
                OneviewBudget(
                    capability_id=cap_id,
                    cp_plan_id=cp_plan_id,
                    ref_code="sustained_ou",
                    title="Sustained O/U",
                    date=cur_date,
                    value=float(sustained_live),
                    unit="FTE",
                )
            )

            session.add(
                OneviewRosterSummary(
                    capability_id=cap_id,
                    snapshot_week=cur_date,
                    active_employees=int(hc.get("closing", 0)),
                    training_starting_this_week=int(hc.get("nest", 0)),
                    transferred_plan_this_week=int(hc.get("tin", 0)),
                    terminated_last_week=int(hc.get("tout", 0)),
                    planned_attrition_this_week=int(hc.get("attr", 0)),
                    promotion_planned_this_week=int(hc.get("promo", 0)),
                    move_to_loa=int(hc.get("loaIn", 0)),
                    back_from_loa=int(hc.get("loaOut", 0)),
                )
            )

        attr_rate = float(row.get("attr12", 0))
        for stage in ATTRITION_STAGES:
            session.add(
                OneviewAttritionAssumption(
                    map_activity_id=cp_plan_id,
                    stage=stage,
                    attrition_perc=attr_rate,
                    source_id=1,
                    last_updated_on_utc=NOW,
                )
            )

        cls = row.get("cls")
        if cls and cur_date:
            class_ref = _class_name(cap_id)
            train_wk = int(cls.get("trainWk", 2))
            nest_wk = int(cls.get("nestWk", 1))
            cls_date = _parse_cls_date(cls.get("date", "")) or cur_date
            train_start = cls_date
            nest_start = cls_date + timedelta(weeks=train_wk)
            prod_start = nest_start + timedelta(weeks=nest_wk)
            plan_hc = float(cls.get("plan", 0))
            actual_hc = float(cls.get("actual", 0))
            train_hc = float(cls.get("trainHC", plan_hc))
            roster_id = _roster_id(cp_plan_id)

            session.add(
                OneviewNewHire(
                    capability_id=cap_id,
                    source_id=cp_plan_id,
                    cp_plan_id=cp_plan_id,
                    class_reference=class_ref,
                    class_status=cls.get("status", "missing"),
                    class_type="Training",
                    induction_date=cls_date - timedelta(days=7),
                    planned_start_date=cls_date,
                    actual_start_date=cls_date if actual_hc else None,
                    training_start_date=train_start,
                    nesting_start_date=nest_start,
                    production_start_date=prod_start,
                    training_weeks=train_wk,
                    nesting_weeks=nest_wk,
                    plan_hc=plan_hc,
                    actual_hc=actual_hc,
                    graduate_needed=max(0.0, plan_hc - actual_hc),
                    billable_hc=actual_hc,
                    non_billable_hc=max(0.0, train_hc - actual_hc),
                    new_hires=plan_hc,
                    original_plan_hc=plan_hc,
                    fixed_flexi_hours_status="Fixed Hours",
                    map_id=map_id,
                    activity_id=activity_id,
                )
            )

            session.add(
                OneviewRosterWorkStatus(
                    cp_plan_id=cp_plan_id,
                    employee_id=f"EMP-{cp_plan_id:05d}",
                    type="Training",
                    from_date=train_start,
                    to_date=prod_start - timedelta(days=1),
                    class_reference=class_ref,
                    hiring_sequence=1,
                    cp_roster_id=roster_id,
                    map_id=map_id,
                    activity_id=activity_id,
                    **scope,
                )
            )
            session.add(
                OneviewRosterLog(
                    cp_plan_id=cp_plan_id,
                    employee_id=f"EMP-{cp_plan_id:05d}",
                    work_status="Active" if cls.get("status") == "mapped" else "Pending",
                    effective_date=cls_date,
                    class_reference=class_ref,
                    hiring_sequence=1,
                    cp_roster_id=roster_id,
                    map_id=map_id,
                    activity_id=activity_id,
                    **scope,
                )
            )
            session.add(OneviewRosterRole(cp_roster_id=roster_id, role="Agent"))

        extra = enrichment.get(cap_id) or {}
        plan_meta[cap_id] = {
            "weeks": weeks,
            "curIdx": cur_idx,
            "ou": ou_now,
            "sustained": sustained_live,
            "minOUfwd": min_ou_live,
            "closingFTE": computed_close,
            "availHrs": row.get("availHrs", 40),
            "shrink12": row.get("shrink12", 0),
            "attr12": extra.get("attr12", row.get("attr12", 0)),
            "hire12": extra.get("hire12", 0),
            "billable": billable,
            "isVol": row.get("isVol", False),
            "region": row.get("region", ""),
            "program": row["program"],
            "site": row["site"],
            "lob": row["lob"],
            "planner": row.get("planner", ""),
            "vertical": row.get("vertical", ""),
            "hcCur": hc_cur,
            "hcLast": hc_last,
            "cls": cls,
            "sAttr": extra.get("sAttr"),
            "sAttrPlan": extra.get("sAttrPlan"),
            "sHire": extra.get("sHire"),
            "sFcst": extra.get("sFcst"),
            "sActVol": extra.get("sActVol"),
            "sAhtGoal": extra.get("sAhtGoal"),
            "sAhtAct": extra.get("sAhtAct"),
            "ouShrink": extra.get("ouShrink", ou_now) if extra.get("ouShrink") is None else round(float(extra.get("ouShrink")) + proj_delta, 2),
        }

    counts["oneview_hierarchy"] = len(data)

    chat_session = CapeChatSession(
        id=uuid.uuid4(),
        username=demo_planner,
        title="Portfolio triage review",
        is_system=False,
        session_context={"source": "prototype", "cycle": "Week of Aug 02, 2026"},
    )
    session.add(chat_session)
    await session.flush()
    session.add(
        CapeChatMessage(
            session_id=chat_session.id,
            role="assistant",
            content="Three plans need a decision today. CP FTE Based has a roster gap — fix that before overtime.",
            extras={"intent": "triage"},
        )
    )
    session.add(
        CapeChatMessage(
            session_id=chat_session.id,
            role="user",
            content="Show me CAP00010 shrinkage forward weeks.",
            extras={"cap_id": "CAP00010"},
        )
    )
    counts["cape_chat_sessions"] = 1
    counts["cape_chat_messages"] = 2

    session.add(
        CapeReminder(
            username=demo_planner,
            text="Review roster gaps before posting the execution queue",
            due_at=NOW + timedelta(days=1),
            repeat="none",
            status="active",
            delivery_channel="in_app",
        )
    )
    counts["cape_reminders"] = 1

    session.add(
        CapeRecommendationThresholds(
            username=demo_planner,
            thresholds={
                "dec_sustained_below": -2.0,
                "auto_sustained_above": 2.0,
                "shrink_gap_pct": 3.0,
            },
        )
    )
    counts["cape_recommendation_thresholds"] = 1

    for filename in ("001_cape_schema.sql", "002_pgboss_schema.sql", "003_cape_indexes.sql"):
        session.add(SchemaMigration(filename=filename))
    counts["schema_migrations"] = 3

    await set_json_setting(session, DEMO_PLAN_META, plan_meta)
    await set_json_setting(
        session,
        DEMO_PLANNING_CYCLE,
        {"id": 1, "week_label": "Week of Aug 02, 2026"},
    )
    await _seed_app_settings(session)
    await _seed_pgboss(session)
    await session.commit()
    return counts


async def _seed_app_settings(session: AsyncSession) -> None:
    await set_json_setting(
        session,
        DEMO_ACTION_PACKAGES,
        [
            {
                "id": 1,
                "cap_id": "CAP00010",
                "ot_hrs": 0.0,
                "xu_fte": 6.68,
                "hire_count": 0,
                "status": "queued",
                "description": "OT 0.00 hrs · loan 6.68 FTE from CAP00013 · hire 0 · accepted (edited)",
            },
            {
                "id": 2,
                "cap_id": "CAP00349",
                "ot_hrs": 80.24,
                "xu_fte": 0.0,
                "hire_count": 0,
                "status": "queued",
                "description": "OT 80.24 hrs · loan 0.00 FTE · hire 0 · accepted",
            },
            {
                "id": 3,
                "cap_id": "CAP00018",
                "ot_hrs": 0.0,
                "xu_fte": 0.0,
                "hire_count": 0,
                "status": "queued",
                "description": "Shrinkage plan corrected 25.72% → 31.98% · no spend",
            },
            {
                "id": 4,
                "cap_id": "CAP00022",
                "ot_hrs": 0.0,
                "xu_fte": 0.0,
                "hire_count": 0,
                "status": "queued",
                "description": "Shrinkage plan corrected 42.33% → 45.61% · no spend",
            },
        ],
    )
    await set_json_setting(
        session,
        DEMO_AGENT_MEMORIES,
        [
            {
                "id": 1,
                "rule_text": "Fix roster gaps before recommending overtime or hiring.",
                "source": "You corrected me · 11 Jun · applied to 9 plans since",
                "applied_count": 9,
                "confidence": "locked",
            },
            {
                "id": 2,
                "rule_text": "Never lend from FE Test — it is not real capacity.",
                "source": "You corrected me · 22 Jul · excluded from every allocation",
                "applied_count": 0,
                "confidence": "locked",
            },
            {
                "id": 3,
                "rule_text": "Keep 1 FTE of headroom in any lending plan, and stay inside the region first.",
                "source": "From your conversation · 4 Aug · applied to 6 transfers",
                "applied_count": 6,
                "confidence": "high",
            },
        ],
    )
    await set_json_setting(
        session,
        DEMO_TIME_LEDGER,
        [
            {"id": 1, "label": "Reading 11 plans × 7 steps (83 screens)", "minutes": 750},
            {"id": 2, "label": "Cross-plan donor matching", "minutes": 200},
            {"id": 3, "label": "Roster reconciliation · 9 classes", "minutes": 135},
            {"id": 4, "label": "Shrinkage variance review", "minutes": 160},
            {"id": 5, "label": "Building the execution queue", "minutes": 65},
        ],
    )
    session.add(
        AppSetting(
            option_key="demo.seed_version",
            option_value="prototype-v1",
            value_type="text",
        )
    )


async def _seed_pgboss(session: AsyncSession) -> None:
    reminder_id = str(uuid.uuid4())
    job_id = str(uuid.uuid4())
    archived_id = str(uuid.uuid4())
    await session.execute(
        text(
            """
            INSERT INTO pgboss.version (version, maintained_on, cron_on, monitored_on)
            VALUES (24, :now, :now, NULL)
            ON CONFLICT (version) DO NOTHING
            """
        ),
        {"now": NOW},
    )
    await session.execute(
        text(
            """
            INSERT INTO pgboss.queue (name, policy, partition_name, created_on, updated_on)
            VALUES
              ('__pgboss__send-it', 'standard', 'j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3', :now, :now),
              ('reminder-deliver', 'standard', 'jad8b1294bceffd7e14a2620d118f16f28a4f3ae9808d0edefb3671ea', :now, :now)
            ON CONFLICT (name) DO NOTHING
            """
        ),
        {"now": NOW},
    )
    await session.execute(
        text(
            """
            INSERT INTO pgboss.schedule (name, cron, timezone, data, created_on, updated_on)
            VALUES ('reminder-deliver', '30 2 * * *', 'UTC', CAST(:data AS jsonb), :now, :now)
            ON CONFLICT (name) DO NOTHING
            """
        ),
        {"data": json.dumps({"demo": True}), "now": NOW},
    )
    await session.execute(
        text(
            """
            INSERT INTO pgboss.subscription (event, name, created_on, updated_on)
            VALUES ('demo-ready', 'reminder-deliver', :now, :now)
            ON CONFLICT (event, name) DO NOTHING
            """
        ),
        {"now": NOW},
    )
    await session.execute(
        text(
            """
            INSERT INTO pgboss.job (
                id, name, priority, data, state, retry_limit, retry_count, retry_delay,
                retry_backoff, start_after, expire_in, created_on, keep_until, policy
            )
            VALUES (
                CAST(:id AS uuid), 'reminder-deliver', 0, CAST(:data AS jsonb), 'created', 3, 0, 60,
                false, :now, '00:15:00', :now, :keep_until, 'standard'
            )
            ON CONFLICT DO NOTHING
            """
        ),
        {"id": job_id, "data": json.dumps({"reminderId": reminder_id, "demo": True}), "now": NOW, "keep_until": NOW + timedelta(days=14)},
    )
    await session.execute(
        text(
            """
            INSERT INTO pgboss.archive (
                id, name, priority, data, state, retry_limit, retry_count, retry_delay,
                retry_backoff, start_after, expire_in, created_on, completed_on, keep_until, policy, archived_on
            )
            VALUES (
                CAST(:id AS uuid), 'reminder-deliver', 0, CAST(:data AS jsonb), 'completed', 3, 0, 60,
                false, :now, '00:15:00', :now, :now, :keep_until, 'standard', :now
            )
            ON CONFLICT DO NOTHING
            """
        ),
        {"id": archived_id, "data": json.dumps({"reminderId": reminder_id, "demo": True}), "now": NOW, "keep_until": NOW + timedelta(days=14)},
    )
