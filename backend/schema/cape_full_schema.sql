-- Cape public schema (structure only) — from cape-pg-data.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SEQUENCE IF NOT EXISTS oneview_new_hire_id_seq;
CREATE SEQUENCE IF NOT EXISTS schema_migrations_id_seq;
CREATE SEQUENCE IF NOT EXISTS app_settings_id_seq;
CREATE SEQUENCE IF NOT EXISTS oneview_roster_work_status_id_seq;
CREATE SEQUENCE IF NOT EXISTS oneview_roster_log_id_seq;

DROP TABLE IF EXISTS public.cape_chat_messages CASCADE;
DROP TABLE IF EXISTS public.cape_chat_sessions CASCADE;
DROP TABLE IF EXISTS public.cape_reminders CASCADE;
DROP TABLE IF EXISTS public.cape_recommendation_thresholds CASCADE;
DROP TABLE IF EXISTS public.oneview_roster_log CASCADE;
DROP TABLE IF EXISTS public.oneview_roster_work_status CASCADE;
DROP TABLE IF EXISTS public.oneview_roster_role CASCADE;
DROP TABLE IF EXISTS public.oneview_header_details CASCADE;
DROP TABLE IF EXISTS public.oneview_planner_dataset CASCADE;
DROP TABLE IF EXISTS public.oneview_shrinkage CASCADE;
DROP TABLE IF EXISTS public.oneview_hierarchy CASCADE;
DROP TABLE IF EXISTS public.oneview_budget CASCADE;
DROP TABLE IF EXISTS public.oneview_roster_summary CASCADE;
DROP TABLE IF EXISTS public.oneview_attrition_assumption CASCADE;
DROP TABLE IF EXISTS public.oneview_title_translation CASCADE;
DROP TABLE IF EXISTS public.oneview_new_hire CASCADE;
DROP TABLE IF EXISTS public.app_settings CASCADE;
DROP TABLE IF EXISTS public.schema_migrations CASCADE;

-- Legacy demo tables (removed)
DROP TABLE IF EXISTS public.roster_classes CASCADE;
DROP TABLE IF EXISTS public.headcount_snapshots CASCADE;
DROP TABLE IF EXISTS public.cap_plan_weeks CASCADE;
DROP TABLE IF EXISTS public.cap_plans CASCADE;
DROP TABLE IF EXISTS public.action_packages CASCADE;
DROP TABLE IF EXISTS public.agent_memories CASCADE;
DROP TABLE IF EXISTS public.time_ledger_entries CASCADE;
DROP TABLE IF EXISTS public.planning_cycles CASCADE;
DROP TABLE IF EXISTS public.programs CASCADE;
DROP TABLE IF EXISTS public.sites CASCADE;

CREATE TABLE public.oneview_new_hire (
    id int8 NOT NULL DEFAULT nextval('oneview_new_hire_id_seq'::regclass),
    capability_id text NOT NULL,
    source_id int4,
    cp_plan_id int4,
    class_reference text,
    class_status text,
    class_type text,
    induction_date date,
    planned_start_date date,
    actual_start_date date,
    training_start_date date,
    nesting_start_date date,
    production_start_date date,
    training_weeks int4,
    nesting_weeks int4,
    plan_hc float8,
    actual_hc float8,
    graduate_needed float8,
    billable_hc float8,
    non_billable_hc float8,
    new_hires float8,
    transfer_in float8,
    transfer_out float8,
    synced_at timestamptz NOT NULL DEFAULT now(),
    original_plan_hc float8,
    fixed_flexi_hours_status text,
    map_id int4,
    activity_id int4,
    PRIMARY KEY (id)
);

CREATE TABLE public.oneview_title_translation (
    id int4 NOT NULL,
    actual_name text NOT NULL,
    display_name text,
    translated_name text,
    source_table_name text,
    column_type text,
    synced_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id)
);

CREATE TABLE public.oneview_attrition_assumption (
    map_activity_id int4 NOT NULL,
    stage text NOT NULL,
    attrition_perc numeric,
    source_id int4,
    last_updated_on_utc timestamptz,
    synced_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (map_activity_id, stage)
);

CREATE TABLE public.oneview_roster_summary (
    capability_id text NOT NULL,
    snapshot_week date,
    pending_terminations int4 NOT NULL DEFAULT 0,
    active_employees int4 NOT NULL DEFAULT 0,
    past_employees int4 NOT NULL DEFAULT 0,
    training_starting_this_week int4 NOT NULL DEFAULT 0,
    nesting_starting_this_week int4 NOT NULL DEFAULT 0,
    nesting_week_extended_for int4 NOT NULL DEFAULT 0,
    terminated_last_week int4 NOT NULL DEFAULT 0,
    planned_attrition_this_week int4 NOT NULL DEFAULT 0,
    transferred_plan_this_week int4 NOT NULL DEFAULT 0,
    promotion_planned_this_week int4 NOT NULL DEFAULT 0,
    move_to_loa int4 NOT NULL DEFAULT 0,
    back_from_loa int4 NOT NULL DEFAULT 0,
    synced_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (capability_id)
);

CREATE TABLE public.oneview_budget (
    capability_id text NOT NULL,
    cp_plan_id int4 NOT NULL,
    ref_code text,
    title text NOT NULL,
    date date NOT NULL,
    value float8,
    unit text,
    synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.cape_chat_sessions (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    username text NOT NULL,
    title text,
    is_system bool NOT NULL DEFAULT false,
    session_context jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id)
);

CREATE TABLE public.cape_chat_messages (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES public.cape_chat_sessions(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text, 'error'::text])),
    content text NOT NULL,
    extras jsonb,
    is_read bool NOT NULL DEFAULT true,
    feedback_type text CHECK (feedback_type = ANY (ARRAY['positive'::text, 'negative'::text])),
    feedback_data jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    acknowledged_at timestamptz,
    PRIMARY KEY (id)
);

CREATE TABLE public.schema_migrations (
    id int4 NOT NULL DEFAULT nextval('schema_migrations_id_seq'::regclass),
    filename text NOT NULL,
    ran_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id)
);

CREATE TABLE public.app_settings (
    id int4 NOT NULL DEFAULT nextval('app_settings_id_seq'::regclass),
    option_key text NOT NULL UNIQUE,
    option_value text NOT NULL,
    value_type text NOT NULL DEFAULT 'text'::text CHECK (value_type = ANY (ARRAY['text'::text, 'boolean'::text, 'number'::text, 'json'::text])),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id)
);

CREATE TABLE public.cape_reminders (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    username text NOT NULL,
    text text NOT NULL,
    due_at timestamptz,
    repeat text NOT NULL DEFAULT 'none'::text,
    status text NOT NULL DEFAULT 'active'::text,
    delivery_channel text NOT NULL DEFAULT 'in_app'::text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id)
);

CREATE TABLE public.cape_recommendation_thresholds (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    username text NOT NULL,
    thresholds jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id)
);

CREATE TABLE public.oneview_hierarchy (
    cp_plan_id int4 NOT NULL,
    capability_id text,
    cp_plan_name text NOT NULL,
    cp_plan_start_date date,
    cp_plan_end_date date,
    cp_plan_type_id int4,
    cp_plan_type text,
    first_day_of_week text,
    map_activity_id int4,
    map_id int4,
    organization_id int4,
    business_entity_id int4,
    vertical_id int4,
    program_id int4,
    lob_id int4,
    sub_lob_id int4,
    activity_id int4,
    partner_id int4,
    site_id int4,
    location_id int4,
    country_id int4,
    region_id int4,
    organization_name text,
    business_entity_name text,
    vertical_name text,
    program_name text,
    lob_name text,
    sub_lob_name text,
    activity_name text,
    partner_name text,
    site_name text,
    location_name text,
    country_name text,
    region_name text,
    is_captive int4,
    hierarchy text,
    synced_at timestamptz NOT NULL DEFAULT now(),
    planner text,
    manager text,
    director text,
    PRIMARY KEY (cp_plan_id)
);

CREATE TABLE public.oneview_shrinkage (
    cp_plan_id int4 NOT NULL,
    capability_id text,
    organization text,
    business_entity text,
    vertical text,
    program text,
    lob text,
    sub_lob text,
    activity text,
    site text,
    date date NOT NULL,
    shrinkage_type text NOT NULL,
    shrinkage_subtype text NOT NULL,
    segment text NOT NULL,
    title_type text NOT NULL,
    percent_value float8,
    hours_value float8,
    is_billable bool,
    is_hide bool,
    is_nesting bool,
    last_updated_on_utc timestamp,
    synced_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (cp_plan_id, date, shrinkage_type, shrinkage_subtype, segment, title_type)
);

CREATE TABLE public.oneview_planner_dataset (
    cp_plan_id int4 NOT NULL,
    capability_id text,
    organization text,
    business_entity text,
    vertical text,
    program text,
    lob text,
    sub_lob text,
    activity text,
    site text,
    date date NOT NULL,
    kpi_key text NOT NULL,
    value float8,
    last_updated_on_utc timestamp,
    synced_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (cp_plan_id, date, kpi_key)
);

CREATE TABLE public.oneview_header_details (
    cp_plan_id int4 NOT NULL,
    dataset_type text NOT NULL,
    capability_id text,
    organization text,
    business_entity text,
    vertical text,
    program text,
    lob text,
    sub_lob text,
    activity text,
    site text,
    date date NOT NULL,
    ref_code text NOT NULL,
    kpi_group text NOT NULL DEFAULT ''::text,
    type text NOT NULL DEFAULT ''::text,
    sub_type text NOT NULL DEFAULT ''::text,
    title text NOT NULL DEFAULT ''::text,
    title_type text NOT NULL DEFAULT ''::text,
    unit text NOT NULL DEFAULT ''::text,
    value float8,
    is_hide bool NOT NULL DEFAULT false,
    is_billable bool NOT NULL DEFAULT false,
    last_updated_on_utc timestamp,
    synced_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (cp_plan_id, date, ref_code, title_type, type, sub_type)
);

CREATE TABLE public.oneview_roster_work_status (
    id int8 NOT NULL DEFAULT nextval('oneview_roster_work_status_id_seq'::regclass),
    cp_plan_id int4 NOT NULL,
    capability_id text,
    organization text,
    business_entity text,
    vertical text,
    program text,
    lob text,
    sub_lob text,
    activity text,
    site text,
    employee_id text,
    type text,
    from_date date,
    to_date date,
    class_reference text,
    hiring_sequence int4,
    map_id int4,
    activity_id int4,
    synced_at timestamptz NOT NULL DEFAULT now(),
    cp_roster_id int4,
    PRIMARY KEY (id)
);

CREATE TABLE public.oneview_roster_log (
    id int8 NOT NULL DEFAULT nextval('oneview_roster_log_id_seq'::regclass),
    cp_plan_id int4,
    capability_id text,
    organization text,
    business_entity text,
    vertical text,
    program text,
    lob text,
    sub_lob text,
    activity text,
    site text,
    employee_id text,
    work_status text,
    effective_date date,
    actual_terminate_date date,
    class_reference text,
    hiring_sequence int4,
    map_id int4,
    activity_id int4,
    synced_at timestamptz NOT NULL DEFAULT now(),
    cp_roster_id int4,
    PRIMARY KEY (id)
);

CREATE TABLE public.oneview_roster_role (
    cp_roster_id int4 NOT NULL,
    role text,
    synced_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (cp_roster_id)
);

CREATE INDEX IF NOT EXISTS ix_oneview_hierarchy_cap ON public.oneview_hierarchy(capability_id);
CREATE INDEX IF NOT EXISTS ix_oneview_planner_scope ON public.oneview_planner_dataset(capability_id, kpi_key, date);
CREATE INDEX IF NOT EXISTS ix_oneview_shrinkage_scope ON public.oneview_shrinkage(capability_id, date);
CREATE INDEX IF NOT EXISTS ix_new_hire_cap ON public.oneview_new_hire(capability_id);
CREATE INDEX IF NOT EXISTS idx_cape_chat_messages_session_created ON public.cape_chat_messages(session_id, created_at);
