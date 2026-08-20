"""Scenario command sequences streamed over WebSocket — mirrors frontend scenarios.js."""

from __future__ import annotations

from typing import Any

ScenarioStep = dict[str, Any]


def _steps(*commands: tuple[str, list]) -> list[ScenarioStep]:
    return [{"cmd": cmd, "args": args} for cmd, args in commands]


SCENARIOS: dict[str, list[dict[str, Any]]] = {
    "brief": [
        {"label": "Vera opens", "commands": _steps(("ast", ["Standing by"]), ("wait", [400]))},
        {
            "label": "Unprompted",
            "commands": _steps(
                ("say", ["Morning. I read all eleven plans at six. Eight of them need nothing from you today."]),
            ),
        },
        {
            "label": "Reads the portfolio",
            "commands": _steps(
                ("push", ["a", "Agent · action", "11 plans · 83 steps read · triaged by what changes a decision"]),
                ("addTime", [750, "reading 83 screens"]),
                ("reveal", ["dec"]),
                ("setCount", ["c1", "3 plans"]),
            ),
        },
        {
            "label": "Names them",
            "commands": _steps(
                (
                    "say",
                    [
                        "Three need a decision, across two programs. CP FTE Based is genuinely short today. "
                        "Two more look fine this week and go badly negative by late September."
                    ],
                ),
            ),
        },
        {
            "label": "Shows autopilot set",
            "commands": _steps(("reveal", ["auto"]), ("setCount", ["c2", "4 plans"])),
        },
        {"label": "Folds the rest", "commands": _steps(("showFold", []))},
        {
            "label": "The point",
            "commands": _steps(
                (
                    "say",
                    [
                        "Four more only need a shrinkage correction under rules you gave me. "
                        "The last four are folded, not hidden — open them whenever you like."
                    ],
                ),
            ),
        },
        {
            "label": "Complete",
            "commands": _steps(
                ("say", ["That is eighty-three screens down to three questions. Where do you want to start?"]),
                ("hideCursor", []),
            ),
        },
    ],
    "filter": [
        {"label": "Listening", "commands": _steps(("hear", [1100]))},
        {"label": "You ask", "commands": _steps(("push", ["u", "Planner · voice", "Just show me ACE Retail.", True]))},
        {
            "label": "Filters",
            "commands": _steps(
                ("setFilter", ["ACE Retail"]),
                ("push", ["a", "Agent · action", "filtered · program = ACE Retail"]),
            ),
        },
        {
            "label": "Vera on the cut",
            "commands": _steps(
                ("say", ["ACE Retail is eight plans, net over-under plus sixty-eight point six six. Two of them need you."]),
            ),
        },
        {
            "label": "Back to all",
            "commands": _steps(
                ("setFilter", ["all"]),
                ("push", ["a", "Agent · action", "filter cleared · 11 of 11"]),
            ),
        },
        {
            "label": "Opens the worst",
            "commands": _steps(
                ("openPlan", ["CAP00010"]),
                ("push", ["a", "Agent · action", "opened CAP00010 · CP FTE Based"]),
            ),
        },
        {"label": "Marks the tabs", "commands": _steps(("markTabs", [["ov", "nh", "shr", "rec"]]))},
        {
            "label": "Explains",
            "commands": _steps(
                (
                    "say",
                    [
                        "Seven tabs, all of them open. I have marked the four that change your answer — "
                        "overview, new hire, shrinkage, recommend."
                    ],
                ),
            ),
        },
        {
            "label": "Draws the position",
            "commands": _steps(("drawOUChart", ["CAP00010", {"mark": 8, "lbl": "w/c 09/27"}])),
        },
        {
            "label": "Complete",
            "commands": _steps(
                ("say", ["Flat until late September, then minus twenty-two FTE and it stays there."]),
                ("hideCursor", []),
            ),
        },
    ],
    "peek": [
        {
            "label": "Sets up",
            "commands": _steps(
                ("view", ["plan"]),
                ("markTabs", [["ov", "nh", "shr", "rec"]]),
                ("drawOUChart", ["CAP00010", {"mark": 8, "lbl": "w/c 09/27"}]),
            ),
        },
        {"label": "Listening", "commands": _steps(("hear", [1100]))},
        {
            "label": "You ask",
            "commands": _steps(("push", ["u", "Planner · voice", "Show me the ones you skipped.", True])),
        },
        {"label": "Opens headcount", "commands": _steps(("openTab", ["hc"]), ("push", ["a", "Agent · action", "opened Headcount · step 2"]))},
        {
            "label": "Reads it",
            "commands": _steps(
                (
                    "say",
                    [
                        "Headcount. Opening fifty, closing fifty. "
                        "The only movement all week is two point three eight coming out of nesting."
                    ],
                ),
            ),
        },
        {"label": "Opens attrition", "commands": _steps(("openTab", ["att"]), ("push", ["a", "Agent · action", "opened Attrition · step 5"]))},
        {
            "label": "Reads it",
            "commands": _steps(
                ("say", ["Attrition. Zero actual, zero planned, right across the window. Nothing to adjust."]),
            ),
        },
        {
            "label": "Back to the roster",
            "commands": _steps(("openTab", ["nh"]), ("push", ["a", "Agent · action", "opened New Hire · step 3"])),
        },
        {
            "label": "The catch",
            "commands": _steps(
                (
                    "say",
                    [
                        "This one I did keep. A class ran on the nineteenth and two point four two trained heads "
                        "never made it onto the roster, so the plan cannot see them."
                    ],
                ),
            ),
        },
        {
            "label": "Maps it",
            "commands": _steps(
                ("mapRoster", ["CAP00010"]),
                ("addTime", [135, "roster reconciliation, 9 classes"]),
            ),
        },
        {
            "label": "Complete",
            "commands": _steps(
                (
                    "say",
                    [
                        "Your real gap is six point six eight, not nine point one. "
                        "Nine roster gaps across the portfolio are hiding ninety-three FTE."
                    ],
                ),
                ("hideCursor", []),
            ),
        },
    ],
    "voice": [
        {
            "label": "Sets up",
            "commands": _steps(
                ("view", ["plan"]),
                ("markTabs", [["ov", "nh", "shr", "rec"]]),
                ("drawOUChart", ["CAP00010", {"mark": 8, "lbl": "w/c 09/27"}]),
                ("openTab", ["shr"]),
                ("drawShrChart", ["CAP00010"]),
                ("buildEditor", ["CAP00010"]),
            ),
        },
        {
            "label": "Finds the anomaly",
            "commands": _steps(
                (
                    "push",
                    [
                        "a",
                        "Agent · check",
                        "09/20 planned at 6.0% · neighbouring weeks 49-51% · flagged as inconsistent",
                    ],
                ),
                ("wait", [400]),
            ),
        },
        {
            "label": "Names it",
            "commands": _steps(
                (
                    "say",
                    [
                        "Before you change anything — one cell here is wrong. The week of the twentieth is planned "
                        "at six percent shrinkage. Every week around it is forty-nine."
                    ],
                ),
            ),
        },
        {
            "label": "Why it matters",
            "commands": _steps(
                (
                    "say",
                    [
                        "That single cell makes that week read minus six FTE when it should read about minus forty. "
                        "Your last eight weeks actually ran forty-three point one one."
                    ],
                ),
            ),
        },
        {"label": "Listening", "commands": _steps(("hear", [1200]))},
        {
            "label": "You ask",
            "commands": _steps(
                ("push", ["u", "Planner · voice", "Set all five forward weeks to the eight-week actual.", True]),
            ),
        },
        {
            "label": "Applies it",
            "commands": _steps(
                ("push", ["a", "Agent · action", "5 weeks set to 43.11% · requirement recalculated live"]),
                ("voiceSet", [[[0, 43.11], [1, 43.11], [2, 43.11], [3, 43.11], [4, 43.11]]]),
            ),
        },
        {
            "label": "Reads the impact",
            "commands": _steps(
                (
                    "say",
                    [
                        "Two things happened. The twentieth got much worse and much more honest. "
                        "And the other four were over-planned, so requirement across all five actually falls "
                        "by eleven point nine FTE."
                    ],
                ),
            ),
        },
        {"label": "Listening", "commands": _steps(("hear", [1100]))},
        {
            "label": "You refine",
            "commands": _steps(
                (
                    "push",
                    ["u", "Planner · voice", "Hold the last two at forty-five. I do not trust that drop in October.", True],
                ),
            ),
        },
        {
            "label": "Refines it",
            "commands": _steps(
                ("push", ["a", "Agent · action", "10/11 and 10/18 held at 45.0% · net change now -5.83 FTE"]),
                ("voiceSet", [[[3, 45], [4, 45]]]),
            ),
        },
        {
            "label": "Submits",
            "commands": _steps(
                ("submitShrinkage", ["CAP00010"]),
                ("addTime", [160, "shrinkage variance review"]),
            ),
        },
        {
            "label": "Complete",
            "commands": _steps(
                (
                    "say",
                    [
                        "Submitted. Same formula the platform uses — requirement is billable over one minus shrinkage. "
                        "You can see every number change as I say it."
                    ],
                ),
                ("hideCursor", []),
            ),
        },
    ],
    "mouse": [
        {
            "label": "Sets up",
            "commands": _steps(
                ("view", ["plan"]),
                ("markTabs", [["ov", "nh", "shr", "rec"]]),
                ("drawOUChart", ["CAP00010", {"mark": 8, "lbl": "w/c 09/27"}]),
                ("openTab", ["shr"]),
                ("drawShrChart", ["CAP00010"]),
                ("buildEditor", ["CAP00010"]),
            ),
        },
        {"label": "Listening", "commands": _steps(("hear", [1100]))},
        {"label": "You ask", "commands": _steps(("push", ["u", "Planner · voice", "Let me do this bit myself.", True]))},
        {
            "label": "Hands over",
            "commands": _steps(
                (
                    "say",
                    ["All yours. Drag the sliders or type the numbers — I will keep the requirement and the chart in step."],
                ),
                ("human", [True]),
                ("push", ["s", "Control", "handed to planner · agent watching, not acting"]),
            ),
        },
        {
            "label": "You are driving",
            "commands": _steps(
                ("push", ["s", "Try it", "sliders below are live — drag one and the Overview chart redraws"]),
                ("wait", [600]),
            ),
        },
        {
            "label": "Nudges",
            "commands": _steps(
                (
                    "say",
                    [
                        "Every tab and every control on the left is yours now. "
                        "I am still reading, I am just not touching anything."
                    ],
                ),
            ),
        },
        {
            "label": "Takes it back",
            "commands": _steps(("human", [False]), ("push", ["s", "Control", "returned to agent"])),
        },
        {
            "label": "Complete",
            "commands": _steps(("say", ["Say the word any time and I will step aside again."]), ("hideCursor", [])),
        },
    ],
    "approve": [
        {"label": "Opens the queue", "commands": _steps(("view", ["queue"]), ("reveal", ["pkg"]))},
        {
            "label": "Explains",
            "commands": _steps(
                ("say", ["Four packages are queued. Two cost nothing — they are shrinkage corrections. Two spend something."]),
            ),
        },
        {
            "label": "Ticks the free ones",
            "commands": _steps(("tickPackage", ["CAP00018"]), ("tickPackage", ["CAP00022"])),
        },
        {
            "label": "The spend items",
            "commands": _steps(
                (
                    "say",
                    [
                        "These two need you specifically. Six point six eight FTE loaned between programs, "
                        "and eighty hours of overtime on FTE for coverage."
                    ],
                ),
            ),
        },
        {"label": "Listening", "commands": _steps(("hear", [1200]))},
        {
            "label": "You approve all",
            "commands": _steps(("push", ["u", "Planner · voice", "Approve all four. Execute.", True])),
        },
        {"label": "Selects all", "commands": _steps(("selectAllPackages", []))},
        {
            "label": "Executes",
            "commands": _steps(
                ("executeSelected", []),
                ("addTime", [65, "building the execution queue"]),
            ),
        },
        {
            "label": "Complete",
            "commands": _steps(
                (
                    "say",
                    [
                        "Posted. Eighty hours of overtime, one cross-program loan, no requisitions. "
                        "Both planners notified and you can undo any of it for twenty-four hours."
                    ],
                ),
                ("hideCursor", []),
            ),
        },
    ],
    "ledger": [
        {"label": "Opens the ledger", "commands": _steps(("view", ["time"]), ("wait", [300]))},
        {
            "label": "Vera opens",
            "commands": _steps(("say", ["You asked what this actually saves. Here it is, line by line, for this cycle."])),
        },
        {"label": "Fills it in", "commands": _steps(("fillLedger", []))},
        {
            "label": "Reads the total",
            "commands": _steps(
                ("say", ["Twenty-one hours and fifty minutes absorbed. Two hours and ten minutes left, and all of it is decisions."]),
            ),
        },
        {
            "label": "Where it came from",
            "commands": _steps(
                (
                    "say",
                    [
                        "The biggest single line is reading. Twelve and a half hours of opening plans and scanning weeks, "
                        "and none of it was judgement."
                    ],
                ),
            ),
        },
        {
            "label": "Cites the rules",
            "commands": _steps(
                ("citeMemories", []),
                ("push", ["a", "Agent · recall", "3 standing rules applied today · all from your corrections"]),
            ),
        },
        {
            "label": "The honest bit",
            "commands": _steps(
                (
                    "say",
                    [
                        "Nobody told me to check rosters before recommending overtime. You did, in June, once. "
                        "That one rule is most of what made today different."
                    ],
                ),
            ),
        },
        {
            "label": "Complete",
            "commands": _steps(
                (
                    "say",
                    [
                        "The reading moved to me. The approvals never left you — and if a rule stops being true, delete it."
                    ],
                ),
                ("hideCursor", []),
            ),
        },
    ],
}

# Legacy aliases
SCENARIOS["morning_brief"] = SCENARIOS["brief"]
SCENARIOS["filter_program"] = SCENARIOS["filter"]
