"""Tests for Vera action enrichment — confirmations and narration without actions."""

from app.services.action_enrichment import enrich_actions


def test_affirmation_after_open_plan_offer():
    history = [
        {
            "role": "assistant",
            "content": "CAP00010 needs urgent attention — want me to open that up?",
        },
    ]
    actions = enrich_actions(
        [],
        reply="Sure — opening CAP00010 now.",
        user_message="yes, go ahead",
        history=history,
        active_cap_id=None,
    )
    assert any(a["type"] == "open_plan" and a["params"]["cap_id"] == "CAP00010" for a in actions)


def test_affirmation_after_shrinkage_tab_offer():
    history = [
        {
            "role": "assistant",
            "content": "Fixing shrinkage would help a lot — want me to open the shrinkage tab?",
        },
    ]
    actions = enrich_actions(
        [],
        reply="On it — opening shrinkage.",
        user_message="yes please",
        history=history,
        active_cap_id="CAP00010",
    )
    assert any(a["type"] == "open_tab" and a["params"]["tab"] == "shr" for a in actions)


def test_narration_without_actions_infers_open_tab():
    actions = enrich_actions(
        [],
        reply="My bad — pulling up the shrinkage tab now.",
        user_message="hey we are still not on shrinkage",
        history=[],
        active_cap_id="CAP00010",
    )
    assert any(a["type"] == "open_tab" and a["params"]["tab"] == "shr" for a in actions)


def test_normalize_malformed_tab_action():
    actions = enrich_actions(
        [{"type": "open_tab", "params": {"tab": "shrinkage"}}],
        reply="Opening shrinkage.",
        user_message="go ahead",
        history=[],
        active_cap_id="CAP00010",
    )
    assert actions == [{"type": "open_tab", "params": {"tab": "shr"}}]


def test_create_plan_actions_preserved():
    raw = [
        {"type": "open_create_plan", "params": {}},
        {"type": "set_create_plan_field", "params": {"field": "program", "value": "EZ Rides"}},
        {"type": "submit_create_plan", "params": {}},
    ]
    actions = enrich_actions(
        raw,
        reply="Opening the form — which organization?",
        user_message="create a new cap plan",
        history=[],
        active_cap_id=None,
    )
    assert actions == [
        {"type": "open_create_plan", "params": {}},
        {"type": "set_create_plan_field", "params": {"field": "program", "value": "EZ Rides"}},
        {"type": "submit_create_plan", "params": {}},
    ]


def test_create_plan_field_requires_value():
    actions = enrich_actions(
        [{"type": "set_create_plan_field", "params": {"field": "program"}}],
        reply="Which organization?",
        user_message="create a plan",
        history=[],
    )
    assert actions == []


def test_existing_actions_not_duplicated():
    raw = [{"type": "open_plan", "params": {"cap_id": "CAP00010"}}]
    actions = enrich_actions(
        raw,
        reply="Opening CAP00010.",
        user_message="yes",
        history=[],
        active_cap_id=None,
    )
    assert actions == [{"type": "open_plan", "params": {"cap_id": "CAP00010"}}]
