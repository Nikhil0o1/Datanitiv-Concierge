"""LLM usage events for cost tracking."""

from typing import Sequence, Union

from alembic import op

revision: str = "007_llm_usage"
down_revision: Union[str, None] = "006_concierge_pgvector"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS llm_usage_events (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            provider VARCHAR(32) NOT NULL DEFAULT 'anthropic',
            model VARCHAR(64) NOT NULL,
            endpoint VARCHAR(128) NOT NULL,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            cache_read_tokens INTEGER NOT NULL DEFAULT 0,
            cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
            cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_llm_usage_created_at ON llm_usage_events(created_at);")
    op.execute("CREATE INDEX IF NOT EXISTS idx_llm_usage_endpoint ON llm_usage_events(endpoint);")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS llm_usage_events;")
