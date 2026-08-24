"""Add Concierge nudges and WFM fields on recommendations."""

from typing import Sequence, Union

from alembic import op

revision: str = "005_concierge_nudges_wfm"
down_revision: Union[str, None] = "004_concierge_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

STATEMENTS = [
    "ALTER TABLE concierge_recommendations ADD COLUMN IF NOT EXISTS cap_id VARCHAR(32);",
    "ALTER TABLE concierge_recommendations ADD COLUMN IF NOT EXISTS program VARCHAR(128);",
    "ALTER TABLE concierge_recommendations ADD COLUMN IF NOT EXISTS domain VARCHAR(16) NOT NULL DEFAULT 'operational';",
    "ALTER TABLE concierge_recommendations ADD COLUMN IF NOT EXISTS ui_actions JSONB NOT NULL DEFAULT '[]';",
    "CREATE INDEX IF NOT EXISTS idx_concierge_recs_cap ON concierge_recommendations(cap_id);",
    """
    CREATE TABLE IF NOT EXISTS concierge_nudges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        recommendation_id UUID NOT NULL REFERENCES concierge_recommendations(id) ON DELETE CASCADE,
        incident_id UUID NOT NULL,
        cap_id VARCHAR(32),
        program VARCHAR(128),
        domain VARCHAR(16) NOT NULL DEFAULT 'wfm',
        title VARCHAR(256) NOT NULL,
        summary TEXT NOT NULL,
        explanation TEXT,
        reliability_score DOUBLE PRECISION NOT NULL,
        reliability_factors JSONB NOT NULL DEFAULT '{}',
        ui_actions JSONB NOT NULL DEFAULT '[]',
        priority INTEGER NOT NULL DEFAULT 50,
        status VARCHAR(16) NOT NULL DEFAULT 'pending',
        snoozed_until TIMESTAMPTZ,
        shown_at TIMESTAMPTZ,
        dismissed_at TIMESTAMPTZ,
        accepted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_concierge_nudges_status ON concierge_nudges(status);",
    "CREATE INDEX IF NOT EXISTS idx_concierge_nudges_cap ON concierge_nudges(cap_id);",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_concierge_nudges_rec ON concierge_nudges(recommendation_id);",
    "ALTER TABLE concierge_incidents ADD COLUMN IF NOT EXISTS cap_id VARCHAR(32);",
    "CREATE INDEX IF NOT EXISTS idx_concierge_incidents_cap ON concierge_incidents(cap_id);",
]


def upgrade() -> None:
    for statement in STATEMENTS:
        op.execute(statement.strip())


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS concierge_nudges CASCADE;")
    op.execute("ALTER TABLE concierge_recommendations DROP COLUMN IF EXISTS ui_actions;")
    op.execute("ALTER TABLE concierge_recommendations DROP COLUMN IF EXISTS domain;")
    op.execute("ALTER TABLE concierge_recommendations DROP COLUMN IF EXISTS program;")
    op.execute("ALTER TABLE concierge_recommendations DROP COLUMN IF EXISTS cap_id;")
    op.execute("ALTER TABLE concierge_incidents DROP COLUMN IF EXISTS cap_id;")
