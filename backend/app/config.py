from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

# libpq query params that asyncpg does not accept when passed through the URL.
_ASYNCPG_UNSUPPORTED_QUERY_PARAMS = frozenset(
    {"sslmode", "channel_binding", "options", "gssencmode", "krbsrvname"}
)


def _normalize_database_url(url: str) -> str:
    """Normalize Postgres URLs for SQLAlchemy asyncpg (Render, Neon, etc.)."""
    if url.startswith("postgres://"):
        url = "postgresql+asyncpg://" + url[len("postgres://") :]
    elif url.startswith("postgresql://"):
        url = "postgresql+asyncpg://" + url[len("postgresql://") :]

    parsed = urlparse(url)
    sslmode = None
    cleaned_query: list[tuple[str, str]] = []
    for key, value in parse_qsl(parsed.query, keep_blank_values=True):
        if key == "sslmode":
            sslmode = value
            continue
        if key in _ASYNCPG_UNSUPPORTED_QUERY_PARAMS:
            continue
        cleaned_query.append((key, value))

    if sslmode and not any(key == "ssl" for key, _ in cleaned_query):
        if sslmode in {"require", "verify-ca", "verify-full"}:
            cleaned_query.append(("ssl", "require"))
        elif sslmode == "prefer":
            cleaned_query.append(("ssl", "prefer"))

    return urlunparse(parsed._replace(query=urlencode(cleaned_query)))


def database_connect_args(url: str) -> dict:
    """Extra asyncpg connect args for hosted Postgres (Neon, etc.)."""
    host = urlparse(url).hostname or ""
    if host in {"localhost", "127.0.0.1"}:
        return {}
    if "ssl=" in url:
        return {}
    return {"ssl": True}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/capability"
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-6"
    elevenlabs_api_key: str = ""
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    # Concierge configuration
    concierge_enabled: bool = True
    concierge_worker_enabled: bool = True
    concierge_llm_enabled: bool = True
    concierge_log_level: str = "INFO"
    concierge_telemetry_level: str = "standard"  # minimal | standard | verbose
    concierge_event_retention_days: int = 30
    concierge_monitor_interval_seconds: int = 90
    concierge_nudge_auto_guide: bool = False
    concierge_nudge_snooze_minutes: int = 60
    concierge_nudge_min_reliability: float = 0.55
    concierge_nudge_session_limit: int = 1
    concierge_nudge_cooldown_minutes: int = 30
    concierge_friction_interval_seconds: int = 60
    concierge_learning_interval_seconds: int = 3600
    concierge_retention_interval_seconds: int = 86400
    concierge_nudge_poll_hint_seconds: int = 20
    concierge_structured_logs: bool = True
    concierge_embeddings: str = "auto"  # auto | hash | fastembed
    otel_enabled: bool = False
    otel_service_name: str = "capability-concierge"
    otel_exporter: str = "console"  # console | otlp

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        if isinstance(value, str):
            return _normalize_database_url(value)
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def reliability_weights(self) -> dict[str, float]:
        return {
            "similarity": 0.35,
            "success_rate": 0.35,
            "evidence": 0.20,
            "recency": 0.10,
        }


settings = Settings()
