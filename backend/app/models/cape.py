from datetime import date, datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import Boolean, Date, DateTime, Float, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class OneviewHierarchy(Base):
    __tablename__ = "oneview_hierarchy"

    cp_plan_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    capability_id: Mapped[Optional[str]] = mapped_column(Text)
    cp_plan_name: Mapped[str] = mapped_column(Text, nullable=False)
    cp_plan_start_date: Mapped[Optional[date]] = mapped_column(Date)
    cp_plan_end_date: Mapped[Optional[date]] = mapped_column(Date)
    cp_plan_type_id: Mapped[Optional[int]] = mapped_column(Integer)
    cp_plan_type: Mapped[Optional[str]] = mapped_column(Text)
    first_day_of_week: Mapped[Optional[str]] = mapped_column(Text)
    map_activity_id: Mapped[Optional[int]] = mapped_column(Integer)
    map_id: Mapped[Optional[int]] = mapped_column(Integer)
    organization_id: Mapped[Optional[int]] = mapped_column(Integer)
    business_entity_id: Mapped[Optional[int]] = mapped_column(Integer)
    vertical_id: Mapped[Optional[int]] = mapped_column(Integer)
    program_id: Mapped[Optional[int]] = mapped_column(Integer)
    lob_id: Mapped[Optional[int]] = mapped_column(Integer)
    sub_lob_id: Mapped[Optional[int]] = mapped_column(Integer)
    activity_id: Mapped[Optional[int]] = mapped_column(Integer)
    partner_id: Mapped[Optional[int]] = mapped_column(Integer)
    site_id: Mapped[Optional[int]] = mapped_column(Integer)
    location_id: Mapped[Optional[int]] = mapped_column(Integer)
    country_id: Mapped[Optional[int]] = mapped_column(Integer)
    region_id: Mapped[Optional[int]] = mapped_column(Integer)
    organization_name: Mapped[Optional[str]] = mapped_column(Text)
    business_entity_name: Mapped[Optional[str]] = mapped_column(Text)
    vertical_name: Mapped[Optional[str]] = mapped_column(Text)
    program_name: Mapped[Optional[str]] = mapped_column(Text)
    lob_name: Mapped[Optional[str]] = mapped_column(Text)
    sub_lob_name: Mapped[Optional[str]] = mapped_column(Text)
    activity_name: Mapped[Optional[str]] = mapped_column(Text)
    partner_name: Mapped[Optional[str]] = mapped_column(Text)
    site_name: Mapped[Optional[str]] = mapped_column(Text)
    location_name: Mapped[Optional[str]] = mapped_column(Text)
    country_name: Mapped[Optional[str]] = mapped_column(Text)
    region_name: Mapped[Optional[str]] = mapped_column(Text)
    is_captive: Mapped[Optional[int]] = mapped_column(Integer)
    hierarchy: Mapped[Optional[str]] = mapped_column(Text)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    planner: Mapped[Optional[str]] = mapped_column(Text)
    manager: Mapped[Optional[str]] = mapped_column(Text)
    director: Mapped[Optional[str]] = mapped_column(Text)


class OneviewPlannerDataset(Base):
    __tablename__ = "oneview_planner_dataset"

    cp_plan_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    kpi_key: Mapped[str] = mapped_column(Text, primary_key=True)
    capability_id: Mapped[Optional[str]] = mapped_column(Text)
    organization: Mapped[Optional[str]] = mapped_column(Text)
    business_entity: Mapped[Optional[str]] = mapped_column(Text)
    vertical: Mapped[Optional[str]] = mapped_column(Text)
    program: Mapped[Optional[str]] = mapped_column(Text)
    lob: Mapped[Optional[str]] = mapped_column(Text)
    sub_lob: Mapped[Optional[str]] = mapped_column(Text)
    activity: Mapped[Optional[str]] = mapped_column(Text)
    site: Mapped[Optional[str]] = mapped_column(Text)
    value: Mapped[Optional[float]] = mapped_column(Float)
    last_updated_on_utc: Mapped[Optional[datetime]] = mapped_column(DateTime)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OneviewShrinkage(Base):
    __tablename__ = "oneview_shrinkage"

    cp_plan_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    shrinkage_type: Mapped[str] = mapped_column(Text, primary_key=True)
    shrinkage_subtype: Mapped[str] = mapped_column(Text, primary_key=True)
    segment: Mapped[str] = mapped_column(Text, primary_key=True)
    title_type: Mapped[str] = mapped_column(Text, primary_key=True)
    capability_id: Mapped[Optional[str]] = mapped_column(Text)
    organization: Mapped[Optional[str]] = mapped_column(Text)
    business_entity: Mapped[Optional[str]] = mapped_column(Text)
    vertical: Mapped[Optional[str]] = mapped_column(Text)
    program: Mapped[Optional[str]] = mapped_column(Text)
    lob: Mapped[Optional[str]] = mapped_column(Text)
    sub_lob: Mapped[Optional[str]] = mapped_column(Text)
    activity: Mapped[Optional[str]] = mapped_column(Text)
    site: Mapped[Optional[str]] = mapped_column(Text)
    percent_value: Mapped[Optional[float]] = mapped_column(Float)
    hours_value: Mapped[Optional[float]] = mapped_column(Float)
    is_billable: Mapped[Optional[bool]] = mapped_column(Boolean)
    is_hide: Mapped[Optional[bool]] = mapped_column(Boolean)
    is_nesting: Mapped[Optional[bool]] = mapped_column(Boolean)
    last_updated_on_utc: Mapped[Optional[datetime]] = mapped_column(DateTime)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OneviewHeaderDetails(Base):
    __tablename__ = "oneview_header_details"

    cp_plan_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    ref_code: Mapped[str] = mapped_column(Text, primary_key=True)
    title_type: Mapped[str] = mapped_column(Text, primary_key=True, default="")
    type: Mapped[str] = mapped_column(Text, primary_key=True, default="")
    sub_type: Mapped[str] = mapped_column(Text, primary_key=True, default="")
    dataset_type: Mapped[str] = mapped_column(Text, nullable=False)
    capability_id: Mapped[Optional[str]] = mapped_column(Text)
    organization: Mapped[Optional[str]] = mapped_column(Text)
    business_entity: Mapped[Optional[str]] = mapped_column(Text)
    vertical: Mapped[Optional[str]] = mapped_column(Text)
    program: Mapped[Optional[str]] = mapped_column(Text)
    lob: Mapped[Optional[str]] = mapped_column(Text)
    sub_lob: Mapped[Optional[str]] = mapped_column(Text)
    activity: Mapped[Optional[str]] = mapped_column(Text)
    site: Mapped[Optional[str]] = mapped_column(Text)
    kpi_group: Mapped[str] = mapped_column(Text, default="")
    title: Mapped[str] = mapped_column(Text, default="")
    unit: Mapped[str] = mapped_column(Text, default="")
    value: Mapped[Optional[float]] = mapped_column(Float)
    is_hide: Mapped[bool] = mapped_column(Boolean, default=False)
    is_billable: Mapped[bool] = mapped_column(Boolean, default=False)
    last_updated_on_utc: Mapped[Optional[datetime]] = mapped_column(DateTime)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OneviewNewHire(Base):
    __tablename__ = "oneview_new_hire"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    capability_id: Mapped[str] = mapped_column(Text, nullable=False)
    source_id: Mapped[Optional[int]] = mapped_column(Integer)
    cp_plan_id: Mapped[Optional[int]] = mapped_column(Integer)
    class_reference: Mapped[Optional[str]] = mapped_column(Text)
    class_status: Mapped[Optional[str]] = mapped_column(Text)
    class_type: Mapped[Optional[str]] = mapped_column(Text)
    induction_date: Mapped[Optional[date]] = mapped_column(Date)
    planned_start_date: Mapped[Optional[date]] = mapped_column(Date)
    actual_start_date: Mapped[Optional[date]] = mapped_column(Date)
    training_start_date: Mapped[Optional[date]] = mapped_column(Date)
    nesting_start_date: Mapped[Optional[date]] = mapped_column(Date)
    production_start_date: Mapped[Optional[date]] = mapped_column(Date)
    training_weeks: Mapped[Optional[int]] = mapped_column(Integer)
    nesting_weeks: Mapped[Optional[int]] = mapped_column(Integer)
    plan_hc: Mapped[Optional[float]] = mapped_column(Float)
    actual_hc: Mapped[Optional[float]] = mapped_column(Float)
    graduate_needed: Mapped[Optional[float]] = mapped_column(Float)
    billable_hc: Mapped[Optional[float]] = mapped_column(Float)
    non_billable_hc: Mapped[Optional[float]] = mapped_column(Float)
    new_hires: Mapped[Optional[float]] = mapped_column(Float)
    transfer_in: Mapped[Optional[float]] = mapped_column(Float)
    transfer_out: Mapped[Optional[float]] = mapped_column(Float)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    original_plan_hc: Mapped[Optional[float]] = mapped_column(Float)
    fixed_flexi_hours_status: Mapped[Optional[str]] = mapped_column(Text)
    map_id: Mapped[Optional[int]] = mapped_column(Integer)
    activity_id: Mapped[Optional[int]] = mapped_column(Integer)


class OneviewTitleTranslation(Base):
    __tablename__ = "oneview_title_translation"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actual_name: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[Optional[str]] = mapped_column(Text)
    translated_name: Mapped[Optional[str]] = mapped_column(Text)
    source_table_name: Mapped[Optional[str]] = mapped_column(Text)
    column_type: Mapped[Optional[str]] = mapped_column(Text)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AppSetting(Base):
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    option_key: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    option_value: Mapped[str] = mapped_column(Text, nullable=False)
    value_type: Mapped[str] = mapped_column(Text, default="text")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CapeChatSession(Base):
    __tablename__ = "cape_chat_sessions"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    username: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[Optional[str]] = mapped_column(Text)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    session_context: Mapped[Optional[dict]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CapeChatMessage(Base):
    __tablename__ = "cape_chat_messages"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    session_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    extras: Mapped[Optional[dict]] = mapped_column(JSONB)
    is_read: Mapped[bool] = mapped_column(Boolean, default=True)
    feedback_type: Mapped[Optional[str]] = mapped_column(Text)
    feedback_data: Mapped[Optional[dict]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    acknowledged_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class OneviewAttritionAssumption(Base):
    __tablename__ = "oneview_attrition_assumption"

    map_activity_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    stage: Mapped[str] = mapped_column(Text, primary_key=True)
    attrition_perc: Mapped[Optional[float]] = mapped_column(Float)
    source_id: Mapped[Optional[int]] = mapped_column(Integer)
    last_updated_on_utc: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OneviewRosterSummary(Base):
    __tablename__ = "oneview_roster_summary"

    capability_id: Mapped[str] = mapped_column(Text, primary_key=True)
    snapshot_week: Mapped[Optional[date]] = mapped_column(Date)
    pending_terminations: Mapped[int] = mapped_column(Integer, default=0)
    active_employees: Mapped[int] = mapped_column(Integer, default=0)
    past_employees: Mapped[int] = mapped_column(Integer, default=0)
    training_starting_this_week: Mapped[int] = mapped_column(Integer, default=0)
    nesting_starting_this_week: Mapped[int] = mapped_column(Integer, default=0)
    nesting_week_extended_for: Mapped[int] = mapped_column(Integer, default=0)
    terminated_last_week: Mapped[int] = mapped_column(Integer, default=0)
    planned_attrition_this_week: Mapped[int] = mapped_column(Integer, default=0)
    transferred_plan_this_week: Mapped[int] = mapped_column(Integer, default=0)
    promotion_planned_this_week: Mapped[int] = mapped_column(Integer, default=0)
    move_to_loa: Mapped[int] = mapped_column(Integer, default=0)
    back_from_loa: Mapped[int] = mapped_column(Integer, default=0)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OneviewBudget(Base):
    __tablename__ = "oneview_budget"

    capability_id: Mapped[str] = mapped_column(Text, nullable=False)
    cp_plan_id: Mapped[int] = mapped_column(Integer, nullable=False)
    ref_code: Mapped[Optional[str]] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    value: Mapped[Optional[float]] = mapped_column(Float)
    unit: Mapped[Optional[str]] = mapped_column(Text)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __mapper_args__ = {
        "primary_key": [capability_id, cp_plan_id, title, date],
    }


class OneviewRosterWorkStatus(Base):
    __tablename__ = "oneview_roster_work_status"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cp_plan_id: Mapped[int] = mapped_column(Integer, nullable=False)
    capability_id: Mapped[Optional[str]] = mapped_column(Text)
    organization: Mapped[Optional[str]] = mapped_column(Text)
    business_entity: Mapped[Optional[str]] = mapped_column(Text)
    vertical: Mapped[Optional[str]] = mapped_column(Text)
    program: Mapped[Optional[str]] = mapped_column(Text)
    lob: Mapped[Optional[str]] = mapped_column(Text)
    sub_lob: Mapped[Optional[str]] = mapped_column(Text)
    activity: Mapped[Optional[str]] = mapped_column(Text)
    site: Mapped[Optional[str]] = mapped_column(Text)
    employee_id: Mapped[Optional[str]] = mapped_column(Text)
    type: Mapped[Optional[str]] = mapped_column(Text)
    from_date: Mapped[Optional[date]] = mapped_column(Date)
    to_date: Mapped[Optional[date]] = mapped_column(Date)
    class_reference: Mapped[Optional[str]] = mapped_column(Text)
    hiring_sequence: Mapped[Optional[int]] = mapped_column(Integer)
    map_id: Mapped[Optional[int]] = mapped_column(Integer)
    activity_id: Mapped[Optional[int]] = mapped_column(Integer)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    cp_roster_id: Mapped[Optional[int]] = mapped_column(Integer)


class OneviewRosterLog(Base):
    __tablename__ = "oneview_roster_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cp_plan_id: Mapped[Optional[int]] = mapped_column(Integer)
    capability_id: Mapped[Optional[str]] = mapped_column(Text)
    organization: Mapped[Optional[str]] = mapped_column(Text)
    business_entity: Mapped[Optional[str]] = mapped_column(Text)
    vertical: Mapped[Optional[str]] = mapped_column(Text)
    program: Mapped[Optional[str]] = mapped_column(Text)
    lob: Mapped[Optional[str]] = mapped_column(Text)
    sub_lob: Mapped[Optional[str]] = mapped_column(Text)
    activity: Mapped[Optional[str]] = mapped_column(Text)
    site: Mapped[Optional[str]] = mapped_column(Text)
    employee_id: Mapped[Optional[str]] = mapped_column(Text)
    work_status: Mapped[Optional[str]] = mapped_column(Text)
    effective_date: Mapped[Optional[date]] = mapped_column(Date)
    actual_terminate_date: Mapped[Optional[date]] = mapped_column(Date)
    class_reference: Mapped[Optional[str]] = mapped_column(Text)
    hiring_sequence: Mapped[Optional[int]] = mapped_column(Integer)
    map_id: Mapped[Optional[int]] = mapped_column(Integer)
    activity_id: Mapped[Optional[int]] = mapped_column(Integer)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    cp_roster_id: Mapped[Optional[int]] = mapped_column(Integer)


class OneviewRosterRole(Base):
    __tablename__ = "oneview_roster_role"

    cp_roster_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    role: Mapped[Optional[str]] = mapped_column(Text)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CapeReminder(Base):
    __tablename__ = "cape_reminders"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    username: Mapped[str] = mapped_column(Text, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    due_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    repeat: Mapped[str] = mapped_column(Text, default="none")
    status: Mapped[str] = mapped_column(Text, default="active")
    delivery_channel: Mapped[str] = mapped_column(Text, default="in_app")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CapeRecommendationThresholds(Base):
    __tablename__ = "cape_recommendation_thresholds"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    username: Mapped[str] = mapped_column(Text, nullable=False)
    thresholds: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SchemaMigration(Base):
    __tablename__ = "schema_migrations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    ran_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
