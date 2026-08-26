"""Add pgvector case embeddings and recommendation model_version_id."""

from typing import Sequence, Union

from alembic import op

revision: str = "006_concierge_pgvector"
down_revision: Union[str, None] = "005_concierge_nudges_wfm"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute(
        "ALTER TABLE concierge_recommendations ADD COLUMN IF NOT EXISTS model_version_id INTEGER"
    )
    op.execute(
        "ALTER TABLE concierge_cases ADD COLUMN IF NOT EXISTS embedding_vec vector(384)"
    )
    op.execute(
        """
        UPDATE concierge_cases
        SET embedding_vec = CAST(embedding::text AS vector)
        WHERE embedding IS NOT NULL
          AND jsonb_typeof(embedding) = 'array'
          AND jsonb_array_length(embedding) = 384
          AND embedding_vec IS NULL
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            BEGIN
                CREATE INDEX IF NOT EXISTS idx_concierge_cases_embedding_vec
                ON concierge_cases
                USING hnsw (embedding_vec vector_cosine_ops);
            EXCEPTION WHEN OTHERS THEN
                BEGIN
                    CREATE INDEX IF NOT EXISTS idx_concierge_cases_embedding_vec
                    ON concierge_cases
                    USING ivfflat (embedding_vec vector_cosine_ops)
                    WITH (lists = 10);
                EXCEPTION WHEN OTHERS THEN
                    NULL;
                END;
            END;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_concierge_cases_embedding_vec")
    op.execute("ALTER TABLE concierge_cases DROP COLUMN IF EXISTS embedding_vec")
    op.execute("ALTER TABLE concierge_recommendations DROP COLUMN IF EXISTS model_version_id")
