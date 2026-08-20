# Datanitiv CAP-ABILITY Planning Agent — Backend

Python FastAPI backend for portfolio triage, shrinkage editing, action queue, voice agent, and scenario streaming.

## Stack

- **FastAPI** — REST + WebSocket API
- **SQLAlchemy 2.0 (async)** — ORM with `asyncpg`
- **Alembic** — database migrations
- **PostgreSQL** — persistence

## Setup

### 1. Create virtual environment

```powershell
cd d:\Concierge\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

On macOS/Linux:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure environment

```powershell
copy .env.example .env
```

Edit `.env` and set your keys. **Do not commit `.env` or real API keys.**

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL async URL, e.g. `postgresql+asyncpg://postgres:PASSWORD@localhost:5432/capability` |
| `ANTHROPIC_API_KEY` | Claude API key for `/api/agent/chat` |
| `ELEVENLABS_API_KEY` | ElevenLabs key for `/api/voice/stt` and `/api/voice/tts` |
| `CORS_ORIGINS` | Comma-separated frontend origins |

### 3. Create database

```sql
CREATE DATABASE capability;
```

### 4. Apply Cape schema migration

```powershell
python scripts\reset_db.py
```

This drops legacy demo tables, applies the Cape `oneview_*` schema from `schema/cape_full_schema.sql` (derived from `cape-pg-data.sql`), the `pgboss` job-queue schema from `schema/pgboss_schema.sql`, runs Alembic, and seeds prototype data.

Alternatively:

```powershell
alembic upgrade head
python scripts\seed.py
```

### 5. Seed prototype data (11 plans)

Seeding runs automatically on first startup if `oneview_hierarchy` is empty. To re-seed manually:

```powershell
python scripts\reset_db.py
```

This parses the `var DATA=` array from `d:\Concierge\prototype.html` into Cape tables:

- `oneview_hierarchy` — plan metadata
- `oneview_planner_dataset` — weekly O/U, projected, required FTE
- `oneview_shrinkage` — actual/plan shrinkage %
- `oneview_header_details` — current-week headcount
- `oneview_new_hire` — roster classes
- `app_settings` — demo queue, ledger, memories, planning cycle (no dedicated Cape tables)

## Run the server

```powershell
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- API docs: http://localhost:8000/docs
- Health: http://localhost:8000/api/health

## API routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/cycle/current` | Current planning cycle |
| GET | `/api/plans` | List plans (`?program=` filter) |
| GET | `/api/plans/{cap_id}` | Plan detail with weeks & headcount |
| GET | `/api/triage` | Portfolio triage (dec / auto / quiet) |
| GET | `/api/programs` | Programs with plan counts |
| GET | `/api/queue/packages` | Action queue packages |
| PATCH | `/api/queue/packages/{id}` | Update package |
| POST | `/api/queue/execute` | Post selected packages |
| GET | `/api/ledger` | Time ledger entries |
| GET | `/api/memories` | Agent memory rules |
| POST | `/api/plans/{cap_id}/shrinkage` | Submit forward-week shrinkage |
| POST | `/api/plans/{cap_id}/roster/map` | Map roster class to plan |
| POST | `/api/voice/stt` | ElevenLabs speech-to-text |
| POST | `/api/voice/tts` | ElevenLabs text-to-speech |
| POST | `/api/agent/chat` | Claude voice intent parsing |
| WS | `/ws/agent` | Scenario step streaming |

## Services

- **`triage.py`** — `statusOf`, `shrGap`, triage into dec/auto/quiet (ported from prototype)
- **`shrinkage.py`** — `req_of(billable, shrink_pct) = billable / (1 - shrink/100)`
- **`seed.py`** — Parses prototype HTML and seeds 11 CAP plans

## Development

Create a new migration after model changes:

```powershell
alembic revision --autogenerate -m "describe change"
alembic upgrade head
```
