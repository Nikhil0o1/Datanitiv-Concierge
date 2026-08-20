"""Extract DATA and SC arrays from datanitiv-planning-agent HTML."""
import json
import os
import re
import sys

HTML_PATH = r"c:\Users\nikhi\Downloads\datanitiv-planning-agent_final.html"
OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def extract_data(content: str) -> list:
    m = re.search(r"var DATA=(\[.*?\]);\s*\n", content, re.DOTALL)
    if not m:
        m = re.search(r"var DATA=(\[.*?\]);", content, re.DOTALL)
    if not m:
        raise ValueError("DATA array not found")
    return json.loads(m.group(1))


def extract_scenarios(content: str) -> list:
    m = re.search(r"var SC=(\[.*?\]);\s*\n\s*/\*", content, re.DOTALL)
    if not m:
        m = re.search(r"var SC=(\[.*?\]);", content, re.DOTALL)
    if not m:
        raise ValueError("SC array not found")
    sc_block = m.group(1)

    scenarios = []
    scenario_pat = re.compile(
        r"\{t:'((?:[^'\\]|\\.)*)',s:'((?:[^'\\]|\\.)*)',steps:\[(.*?)\]\}",
        re.DOTALL,
    )
    step_pat = re.compile(r"\{l:'((?:[^'\\]|\\.)*)'")

    for sm in scenario_pat.finditer(sc_block):
        title = sm.group(1).replace("\\'", "'")
        subtitle = sm.group(2).replace("\\'", "'")
        steps_block = sm.group(3)
        steps = [
            {"label": lm.group(1).replace("\\'", "'")}
            for lm in step_pat.finditer(steps_block)
        ]
        scenarios.append({"title": title, "subtitle": subtitle, "steps": steps})

    return scenarios


def describe_fields(plans: list) -> dict:
    fields = {}
    for plan in plans:
        for key, value in plan.items():
            if key in fields:
                continue
            if isinstance(value, list):
                elem = value[0] if value else None
                fields[key] = {
                    "type": "array",
                    "length": len(value),
                    "element_type": type(elem).__name__ if elem is not None else None,
                }
            elif isinstance(value, dict):
                fields[key] = {"type": "object", "keys": list(value.keys())}
            else:
                fields[key] = {"type": type(value).__name__}
    return fields


def main() -> None:
    with open(HTML_PATH, encoding="utf-8") as f:
        content = f.read()

    data = extract_data(content)
    scenarios = extract_scenarios(content)

    os.makedirs(OUT_DIR, exist_ok=True)

    plans_path = os.path.join(OUT_DIR, "plans_data.json")
    scenarios_path = os.path.join(OUT_DIR, "scenarios.json")

    with open(plans_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    with open(scenarios_path, "w", encoding="utf-8") as f:
        json.dump(scenarios, f, indent=2, ensure_ascii=False)

    fields = describe_fields(data)
    summary = {
        "plan_count": len(data),
        "scenario_count": len(scenarios),
        "scenario_steps": [len(s["steps"]) for s in scenarios],
        "fields": fields,
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
