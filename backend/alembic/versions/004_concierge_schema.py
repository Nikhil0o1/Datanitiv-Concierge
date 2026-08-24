"""Add Concierge operational intelligence schema."""

from typing import Sequence, Union

from alembic import op

revision: str = "004_concierge_schema"
down_revision: Union[str, None] = "003_cape_indexes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS concierge_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL UNIQUE,
        schema_version VARCHAR(16) NOT NULL DEFAULT '1.0',
        timestamp TIMESTAMPTZ NOT NULL,
        tenant_id VARCHAR(64),
        user_id VARCHAR(128),
        session_id VARCHAR(128),
        event_type VARCHAR(64) NOT NULL,
        source VARCHAR(32) NOT NULL,
        service VARCHAR(64),
        endpoint VARCHAR(256),
        status_code INTEGER,
        latency_ms DOUBLE PRECISION,
        error_code VARCHAR(64),
        severity VARCHAR(16) NOT NULL DEFAULT 'info',
        metadata JSONB NOT NULL DEFAULT '{}',
        correlation_id VARCHAR(64),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_concierge_events_type ON concierge_events(event_type);",
    "CREATE INDEX IF NOT EXISTS idx_concierge_events_session ON concierge_events(session_id);",
    "CREATE INDEX IF NOT EXISTS idx_concierge_events_ts ON concierge_events(timestamp);",
    "CREATE INDEX IF NOT EXISTS idx_concierge_events_correlation ON concierge_events(correlation_id);",
    """
    CREATE TABLE IF NOT EXISTS concierge_event_queue (
        id SERIAL PRIMARY KEY,
        event_id UUID NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        locked_at TIMESTAMPTZ,
        processed_at TIMESTAMPTZ,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_concierge_queue_status ON concierge_event_queue(status);",
    "CREATE INDEX IF NOT EXISTS idx_concierge_queue_event ON concierge_event_queue(event_id);",
    """
    CREATE TABLE IF NOT EXISTS concierge_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id VARCHAR(128) NOT NULL UNIQUE,
        tenant_id VARCHAR(64),
        user_id VARCHAR(128),
        feature VARCHAR(64),
        started_at TIMESTAMPTZ NOT NULL,
        last_event_at TIMESTAMPTZ NOT NULL,
        event_count INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        resolved BOOLEAN NOT NULL DEFAULT false,
        abandoned BOOLEAN NOT NULL DEFAULT false,
        summary JSONB
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS concierge_baselines (
        id SERIAL PRIMARY KEY,
        feature VARCHAR(64) NOT NULL,
        metric VARCHAR(64) NOT NULL,
        tenant_id VARCHAR(64),
        window_minutes INTEGER NOT NULL DEFAULT 60,
        sample_count INTEGER NOT NULL DEFAULT 0,
        mean_value DOUBLE PRECISION NOT NULL DEFAULT 0,
        std_value DOUBLE PRECISION NOT NULL DEFAULT 0,
        p95_value DOUBLE PRECISION NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_concierge_baselines_feature ON concierge_baselines(feature, metric);",
    """
    CREATE TABLE IF NOT EXISTS concierge_detection_rules (
        id SERIAL PRIMARY KEY,
        name VARCHAR(128) NOT NULL UNIQUE,
        rule_type VARCHAR(32) NOT NULL,
        feature VARCHAR(64) NOT NULL,
        config JSONB NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS concierge_detection_results (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        rule_id INTEGER NOT NULL,
        rule_name VARCHAR(128) NOT NULL,
        feature VARCHAR(64) NOT NULL,
        severity VARCHAR(16) NOT NULL DEFAULT 'medium',
        signal_summary JSONB NOT NULL,
        evidence_event_ids JSONB NOT NULL DEFAULT '[]',
        session_id VARCHAR(128),
        incident_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_concierge_detection_incident ON concierge_detection_results(incident_id);",
    """
    CREATE TABLE IF NOT EXISTS concierge_incidents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        incident_key VARCHAR(32) NOT NULL UNIQUE,
        incident_type VARCHAR(64) NOT NULL,
        severity VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
        status VARCHAR(32) NOT NULL DEFAULT 'DETECTED',
        started_at TIMESTAMPTZ NOT NULL,
        ended_at TIMESTAMPTZ,
        affected_feature VARCHAR(64) NOT NULL,
        affected_user VARCHAR(128),
        tenant_id VARCHAR(64),
        session_id VARCHAR(128),
        signals JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_concierge_incidents_status ON concierge_incidents(status);",
    "CREATE INDEX IF NOT EXISTS idx_concierge_incidents_type ON concierge_incidents(incident_type);",
    """
    CREATE TABLE IF NOT EXISTS concierge_incident_evidence (
        id SERIAL PRIMARY KEY,
        incident_id UUID NOT NULL,
        evidence_type VARCHAR(32) NOT NULL,
        event_id UUID,
        detection_id UUID,
        summary TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_concierge_evidence_incident ON concierge_incident_evidence(incident_id);",
    """
    CREATE TABLE IF NOT EXISTS concierge_cases (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        incident_id UUID,
        case_key VARCHAR(32) NOT NULL UNIQUE,
        incident_type VARCHAR(64) NOT NULL,
        feature VARCHAR(64) NOT NULL,
        summary_text TEXT NOT NULL,
        signals JSONB NOT NULL DEFAULT '{}',
        resolution TEXT NOT NULL,
        outcome VARCHAR(32) NOT NULL DEFAULT 'SUCCESS',
        embedding JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_concierge_cases_type ON concierge_cases(incident_type);",
    """
    CREATE TABLE IF NOT EXISTS concierge_recommendations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        incident_id UUID NOT NULL,
        action TEXT NOT NULL,
        rationale TEXT NOT NULL,
        reliability_score DOUBLE PRECISION NOT NULL,
        reliability_factors JSONB NOT NULL,
        similar_case_ids JSONB NOT NULL DEFAULT '[]',
        rank INTEGER NOT NULL DEFAULT 1,
        explanation TEXT,
        explanation_status VARCHAR(16) NOT NULL DEFAULT 'pending',
        status VARCHAR(32) NOT NULL DEFAULT 'generated',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_concierge_recs_incident ON concierge_recommendations(incident_id);",
    """
    CREATE TABLE IF NOT EXISTS concierge_recommendation_outcomes (
        id SERIAL PRIMARY KEY,
        recommendation_id UUID NOT NULL,
        event_type VARCHAR(32) NOT NULL,
        action_taken TEXT,
        problem_resolved BOOLEAN,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_concierge_outcomes_rec ON concierge_recommendation_outcomes(recommendation_id);",
    """
    CREATE TABLE IF NOT EXISTS concierge_model_versions (
        id SERIAL PRIMARY KEY,
        model_type VARCHAR(32) NOT NULL,
        version VARCHAR(32) NOT NULL,
        dataset_version VARCHAR(32),
        metrics JSONB NOT NULL DEFAULT '{}',
        is_active BOOLEAN NOT NULL DEFAULT false,
        deployed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS concierge_training_examples (
        id SERIAL PRIMARY KEY,
        incident_id UUID,
        recommendation_id UUID,
        input_features JSONB NOT NULL,
        recommendation_text TEXT NOT NULL,
        outcome_label VARCHAR(16) NOT NULL,
        model_version_id INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
]


def upgrade() -> None:
    for statement in STATEMENTS:
        op.execute(statement.strip())


def downgrade() -> None:
    tables = [
        "concierge_training_examples",
        "concierge_model_versions",
        "concierge_recommendation_outcomes",
        "concierge_recommendations",
        "concierge_cases",
        "concierge_incident_evidence",
        "concierge_incidents",
        "concierge_detection_results",
        "concierge_detection_rules",
        "concierge_baselines",
        "concierge_sessions",
        "concierge_event_queue",
        "concierge_events",
    ]
    for table in tables:
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE;")
