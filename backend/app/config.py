from pydantic_settings import BaseSettings, SettingsConfigDict


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
