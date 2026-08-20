-- Indexes and constraints from cape-pg-data.sql (public schema tail)
ALTER TABLE public.cape_chat_messages
    DROP CONSTRAINT IF EXISTS cape_chat_messages_session_id_fkey;

ALTER TABLE public.cape_chat_messages
    ADD CONSTRAINT cape_chat_messages_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.cape_chat_sessions(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS schema_migrations_filename_key ON public.schema_migrations (filename);
CREATE UNIQUE INDEX IF NOT EXISTS app_settings_option_key_key ON public.app_settings (option_key);

CREATE INDEX IF NOT EXISTS idx_cape_chat_messages_unread
    ON public.cape_chat_messages (session_id, is_read) WHERE (is_read = false);

CREATE INDEX IF NOT EXISTS idx_cape_chat_sessions_username_updated
    ON public.cape_chat_sessions (username, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_cape_chat_sessions_system
    ON public.cape_chat_sessions (username, is_system) WHERE (is_system = true);

CREATE INDEX IF NOT EXISTS idx_cape_reminders_username_status
    ON public.cape_reminders (username, status, due_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cape_rec_thresholds_username
    ON public.cape_recommendation_thresholds (username);

CREATE INDEX IF NOT EXISTS idx_cape_rec_thresholds_username
    ON public.cape_recommendation_thresholds (username);

CREATE UNIQUE INDEX IF NOT EXISTS ux_oneview_hierarchy_capability
    ON public.oneview_hierarchy (capability_id) WHERE (capability_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS ix_oneview_hierarchy_names
    ON public.oneview_hierarchy (vertical_name, program_name, lob_name);

CREATE INDEX IF NOT EXISTS ix_oneview_hierarchy_map_activity
    ON public.oneview_hierarchy (map_activity_id);

CREATE UNIQUE INDEX IF NOT EXISTS pk_oneview_shrinkage
    ON public.oneview_shrinkage (cp_plan_id, date, shrinkage_type, shrinkage_subtype, segment, title_type);

CREATE INDEX IF NOT EXISTS ix_oneview_shrinkage_plan ON public.oneview_shrinkage (cp_plan_id, date);
CREATE INDEX IF NOT EXISTS ix_oneview_shrinkage_hier ON public.oneview_shrinkage (vertical, program, lob, date);
CREATE INDEX IF NOT EXISTS ix_oneview_shrinkage_typedate ON public.oneview_shrinkage (shrinkage_type, title_type, date);

CREATE UNIQUE INDEX IF NOT EXISTS pk_oneview_planner_dataset
    ON public.oneview_planner_dataset (cp_plan_id, date, kpi_key);

CREATE INDEX IF NOT EXISTS ix_oneview_planner_plan ON public.oneview_planner_dataset (cp_plan_id, date);
CREATE INDEX IF NOT EXISTS ix_oneview_planner_kpi ON public.oneview_planner_dataset (kpi_key, date);
CREATE INDEX IF NOT EXISTS ix_oneview_planner_hier ON public.oneview_planner_dataset (vertical, program, lob, kpi_key, date);

CREATE UNIQUE INDEX IF NOT EXISTS pk_oneview_header_details
    ON public.oneview_header_details (cp_plan_id, date, ref_code, title_type, type, sub_type);

CREATE INDEX IF NOT EXISTS ix_oneview_hd_plan ON public.oneview_header_details (cp_plan_id, dataset_type, date);
CREATE INDEX IF NOT EXISTS ix_oneview_hd_scope ON public.oneview_header_details (capability_id, ref_code, date);
CREATE INDEX IF NOT EXISTS ix_oneview_hd_type ON public.oneview_header_details (dataset_type, ref_code, date);
CREATE INDEX IF NOT EXISTS ix_oneview_hd_hier ON public.oneview_header_details (vertical, program, lob, ref_code, date);

CREATE INDEX IF NOT EXISTS ix_new_hire_dates ON public.oneview_new_hire (capability_id, planned_start_date);
CREATE INDEX IF NOT EXISTS idx_ovtt_source ON public.oneview_title_translation (source_table_name);
CREATE UNIQUE INDEX IF NOT EXISTS pk_oneview_attrition_assumption ON public.oneview_attrition_assumption (map_activity_id, stage);

CREATE INDEX IF NOT EXISTS idx_ovbudget_cap_date ON public.oneview_budget (capability_id, date);
CREATE INDEX IF NOT EXISTS idx_ovbudget_plan ON public.oneview_budget (cp_plan_id);
CREATE INDEX IF NOT EXISTS idx_ovbudget_title ON public.oneview_budget (title);

CREATE INDEX IF NOT EXISTS ix_roster_ws_plan ON public.oneview_roster_work_status (cp_plan_id);
CREATE INDEX IF NOT EXISTS ix_roster_ws_scope ON public.oneview_roster_work_status (capability_id, type);
CREATE INDEX IF NOT EXISTS ix_roster_ws_dates ON public.oneview_roster_work_status (capability_id, to_date);
CREATE INDEX IF NOT EXISTS ix_roster_ws_rosterid ON public.oneview_roster_work_status (cp_roster_id);
CREATE INDEX IF NOT EXISTS ix_roster_ws_attrib ON public.oneview_roster_work_status (cp_roster_id, type, to_date);

CREATE INDEX IF NOT EXISTS ix_roster_log_plan ON public.oneview_roster_log (cp_plan_id);
CREATE INDEX IF NOT EXISTS ix_roster_log_term ON public.oneview_roster_log (capability_id, work_status, actual_terminate_date);
CREATE INDEX IF NOT EXISTS ix_roster_log_eff ON public.oneview_roster_log (capability_id, effective_date);
CREATE INDEX IF NOT EXISTS ix_roster_log_rosterid ON public.oneview_roster_log (cp_roster_id);
CREATE INDEX IF NOT EXISTS ix_roster_log_status_eff ON public.oneview_roster_log (work_status, effective_date);

CREATE INDEX IF NOT EXISTS ix_roster_role_role ON public.oneview_roster_role (role);
