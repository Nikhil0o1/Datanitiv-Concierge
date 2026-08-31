"""Tests for LLM usage cost tracking."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.usage_tracker import estimate_cost_usd, get_cost_summary, record_llm_usage


class _FakeUsage:
    input_tokens = 1000
    output_tokens = 500
    cache_read_input_tokens = 0
    cache_creation_input_tokens = 0


@pytest.mark.asyncio
async def test_record_and_summarize(db_session: AsyncSession):
    await record_llm_usage(
        model="claude-sonnet-4-6",
        endpoint="agent.chat.stream",
        usage=_FakeUsage(),
    )
    summary = await get_cost_summary(db_session)
    assert summary["totals"]["requests"] >= 1
    assert summary["totals"]["input_tokens"] >= 1000
    assert summary["totals"]["output_tokens"] >= 500
    assert summary["totals"]["cost_usd"] > 0


def test_estimate_cost():
    cost = estimate_cost_usd(model="claude-sonnet-4-6", input_tokens=1_000_000, output_tokens=0)
    assert cost == 3.0
