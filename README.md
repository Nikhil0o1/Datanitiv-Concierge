# Datanitiv CAP-ABILITY Planning Agent

Dynamic full-stack app converted from the HTML prototype (`prototype.html`). The React frontend loads live portfolio data from PostgreSQL via FastAPI — no static mock data.

## Structure

```
Concierge/
├── backend/          # FastAPI + PostgreSQL + Alembic
├── frontend/         # React + Vite
└── prototype.html    # Original design reference
```

## Prerequisites

- **Python 3.11+**
- **Node.js 20+**
- **PostgreSQL** (local)
- API keys for Claude (Anthropic) and ElevenLabs (optional for voice features)

## Quick start

### 1. Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
# Edit .env — set DATABASE_URL and API keys (never commit .env)
python scripts/create_db.py
alembic upgrade head
python scripts/seed.py
uvicorn app.main:app --reload --port 8000
```

The server auto-seeds on first startup if the database is empty.

### 2. Frontend

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 — API requests proxy to port 8000.

### 3. Prototype reference (optional)

```powershell
cd d:\Concierge
python -m http.server 8765
```

Prototype: http://localhost:8765/prototype.html

## Features

- **All 7 plan tabs** — Overview, Headcount, New Hire, Shrinkage (with chart + editor), Attrition, Recommend, Execute
- **Voice UI** — Mic button in agent panel: ElevenLabs STT → Claude intent parsing → TTS playback
- **WebSocket streaming** — Toggle **Stream** in the transport bar to run scenarios from `/ws/agent` (backend-driven step commands)

## URLs

| Service | URL |
|---------|-----|
| React app | http://localhost:5173 |
| API docs | http://localhost:8000/docs |
| Health | http://localhost:8000/api/health |
| Prototype | http://localhost:8765/prototype.html |

## Documentation

- [backend/README.md](backend/README.md) — API routes, migrations, seed script
- [frontend/README.md](frontend/README.md) — Vite dev setup

## Security

Store API keys only in `backend/.env` (gitignored). Do not commit credentials or production data.
