"""OpenTelemetry instrumentation (optional, env-gated)."""

from __future__ import annotations

import logging

from app.config import settings

logger = logging.getLogger("concierge.otel")


def setup_opentelemetry(app) -> None:
    if not settings.otel_enabled:
        return
    try:
        from opentelemetry import trace
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter

        resource = Resource.create({"service.name": settings.otel_service_name})
        provider = TracerProvider(resource=resource)

        if settings.otel_exporter == "console":
            provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
        elif settings.otel_exporter == "otlp":
            from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

            provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))

        trace.set_tracer_provider(provider)
        FastAPIInstrumentor.instrument_app(app)

        from app.database import engine

        SQLAlchemyInstrumentor().instrument(engine=engine.sync_engine if hasattr(engine, "sync_engine") else engine)
        logger.info("OpenTelemetry enabled for %s", settings.otel_service_name)
    except ImportError:
        logger.warning("OpenTelemetry packages not installed; skipping instrumentation")
    except Exception:
        logger.exception("Failed to setup OpenTelemetry")
