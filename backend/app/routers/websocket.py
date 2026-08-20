import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.scenario_stream import SCENARIOS

router = APIRouter(tags=["websocket"])

PAUSE_BETWEEN_STEPS_MS = 185


@router.websocket("/ws/agent")
async def agent_websocket(websocket: WebSocket):
    await websocket.accept()
    running = True

    try:
        while True:
            raw = await websocket.receive_text()
            payload = json.loads(raw)
            action = payload.get("action", "start_scenario")

            if action == "stop":
                running = False
                await websocket.send_json({"type": "stopped"})
                continue

            if action != "start_scenario":
                await websocket.send_json({"type": "error", "message": f"Unknown action: {action}"})
                continue

            scenario = payload.get("scenario", "brief")
            speed = max(0.25, float(payload.get("speed", 1)))
            steps = SCENARIOS.get(scenario, SCENARIOS["brief"])
            running = True

            await websocket.send_json(
                {
                    "type": "scenario_start",
                    "scenario": scenario,
                    "total_steps": len(steps),
                    "label": steps[0]["label"] if steps else "",
                }
            )

            for idx, step in enumerate(steps):
                if not running:
                    break

                await websocket.send_json(
                    {"type": "step_begin", "index": idx, "label": step.get("label", "")}
                )

                for cmd in step.get("commands", []):
                    if not running:
                        break
                    await websocket.send_json(
                        {
                            "type": "command",
                            "cmd": cmd["cmd"],
                            "args": cmd.get("args", []),
                        }
                    )
                    delay = _command_delay(cmd) / speed
                    await asyncio.sleep(delay / 1000.0)

                await websocket.send_json({"type": "step_end", "index": idx})
                await asyncio.sleep(PAUSE_BETWEEN_STEPS_MS / speed / 1000.0)

            if running:
                await websocket.send_json({"type": "scenario_complete", "scenario": scenario})

    except WebSocketDisconnect:
        return
    except json.JSONDecodeError:
        await websocket.send_json({"type": "error", "message": "Invalid JSON payload"})
        await websocket.close()


def _command_delay(cmd: dict) -> int:
    name = cmd.get("cmd", "")
    args = cmd.get("args") or []
    if name == "wait":
        return int(args[0]) if args else 0
    if name == "hear":
        return int(args[0]) if args else 800
    if name == "say":
        text = args[0] if args else ""
        return max(800, len(text.split()) * 94 + 220)
    if name in ("drawOUChart", "drawShrChart"):
        return 800
    if name == "reveal":
        return 800 if args and args[0] in ("dec", "auto") else 400
    if name == "fillLedger":
        return 2000
    return 250
