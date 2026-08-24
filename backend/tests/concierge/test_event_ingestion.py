"""Phase 2 — event ingestion tests."""

import uuid

import pytest


@pytest.mark.asyncio
async def test_ingest_valid_events(client):
    event_id = str(uuid.uuid4())
    payload = {
        "events": [
            {
                "event_id": event_id,
                "event_type": "page_view",
                "source": "frontend",
                "service": "planning-ui",
                "severity": "info",
                "session_id": "test-session-1",
                "metadata": {"view": "portfolio"},
            }
        ]
    }
    res = await client.post("/api/concierge/events", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["accepted"] == 1
    assert data["rejected"] == 0
    assert event_id in data["event_ids"]


@pytest.mark.asyncio
async def test_reject_invalid_source(client):
    payload = {
        "events": [
            {
                "event_type": "click",
                "source": "invalid_source",
                "severity": "info",
            }
        ]
    }
    res = await client.post("/api/concierge/events", json=payload)
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_reject_empty_batch(client):
    res = await client.post("/api/concierge/events", json={"events": []})
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_redact_sensitive_metadata(client):
    payload = {
        "events": [
            {
                "event_type": "form_submission",
                "source": "frontend",
                "severity": "info",
                "metadata": {"password": "secret123", "cap_id": "CAP00001"},
            }
        ]
    }
    res = await client.post("/api/concierge/events", json=payload)
    assert res.status_code == 200
