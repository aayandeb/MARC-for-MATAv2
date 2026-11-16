# MARC for MATA — Version 2

**MARC** (Memphis **A**ccessibility **R**eporting & **C**ommunity) for **MATA** is a web app for the [Memphis Area Transit Authority](https://www.matatransit.com/): live bus positions on a map, GTFS-based trip planning, and tools for riders to report and track **accessibility** issues (ramps, elevators, crowding, signage, and more).

This repository is **version 2** — continued development of the original Rhodes College Hackathon 2026 project.

**Live website:** [https://marc-mata-bus.vercel.app/](https://marc-mata-bus.vercel.app/)

### Origin & credits

- **Original project:** [srijoon/MARC-for-MATA](https://github.com/srijoon/MARC-for-MATA) (Hackathon 2026)
- **Original contributors:** [Srijon Kumar](https://github.com/srijoon) (`noobSrijon`), [Caleb Walters](https://github.com/cwalters04) (`cwalters04`), Sahaf Mahmud, and [Aayan Pratim Deb](https://github.com/aayandeb)
- **This version (v2):** modified and further developed by **[Aayan Pratim Deb](https://github.com/aayandeb)** (`aayandeb`) — including 3D live bus map, route highlighting, GTFS matching improvements, and related UI/API work

The project is a small monorepo:

- **`apps/frontend`** — Next.js UI (map, planning sidebar, issue reporting, optional admin UI)
- **`apps/backend`** — Flask API (MATA vehicle feed, GTFS data, reports stored in MongoDB)

---

## Features

- **Live vehicles** — Fetches real-time bus positions from MATA’s API, enriches them with GTFS route names, colors, terminals, and shape IDs for map overlays. If the feed errors or is not configured, the API returns no vehicles with `source: "unavailable"` and the map says live data is unavailable — it never substitutes fake buses. Set `USE_MOCK_VEHICLES=1` to serve `mock_vehicles.json` for demos; the map then labels it as demo data.
- **3D map overlay** — Buses rendered as GLB models on MapLibre with route labels; selecting a bus highlights its path (traveled vs remaining) and stop markers.
- **Trip planning** — Stop-to-stop and coordinate-based planning using bundled **GTFS** static data (`apps/backend/GTFS/`).
- **Accessibility reports** — Submit issues tied to a bus/route; optional **photo upload** (GridFS) and **AI-assisted** description and severity (via OpenRouter when configured).
- **Route insights** — Optional AI summaries of recent reports per route (OpenRouter).
- **Admin** — Frontend route at `/admin` (password from env) lists unresolved reports by severity; resolves by removing from the database.

---

## Prerequisites

| Tool | Notes |
|------|--------|
| **Python** | 3.10+ recommended (project uses modern typing). |
| **Node.js** | 20+ recommended for Next.js 16. |
| **MongoDB** | Required for **reports**, image storage, and admin features. Without `MONGO_URI`, report endpoints return **503** (“Storage not configured”). |
| **MATA API access** | Configure base URL, path, and line filter via env (see below). For local work without API access, set `USE_MOCK_VEHICLES=1`. |

---

## Environment variables

### Backend (`apps/backend`)

Create a `.env` in `apps/backend` (or export variables in your shell). `python-dotenv` loads them automatically.

| Variable | Purpose |
|----------|---------|
| `MATA_API_BASE_URL` | Base URL for MATA’s vehicle API (no trailing slash required in code). |
| `MATA_VEHICLES_PATH` | Path appended to the base URL for the vehicles endpoint. |
| `MATA_LIGNES` | Comma-separated (or API-specific) line filter passed as the `lignes` query param. |
| `USE_MOCK_VEHICLES` | Optional; `1` serves bundled demo buses instead of the real feed (labelled as demo data in the UI). Leave unset in production. |
| `MONGO_URI` | MongoDB connection string for reports and GridFS image storage. |
| `SECRET_KEY` | Flask secret (set in production). |
| `OPENROUTER_API_KEY` | Optional; enables AI severity scoring, route summaries, and image analysis on reports. |

Reports and GridFS use the MongoDB database named **`marc`** by default (see `app/api/reports.py` / `admin.py`). To use another name, set `MONGODB_DB_NAME` on the Flask app config in code.

### Frontend (`apps/frontend`)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_API_URL` | Backend origin (default **`http://localhost:5001`**). Must be reachable from the browser in dev (CORS is enabled on the API). On Vercel this must be set at **build** time to your deployed API URL. |
| `ADMIN_PASSWORD` | Password for **`POST /api/admin/auth`** used by the admin page. If unset, admin login fails with a server error. |

---

## Local development

### Backend

```bash
cd apps/backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
# Add .env with at least MATA_* and optionally MONGO_URI, OPENROUTER_API_KEY
python wsgi.py
```

The dev server listens on **port 5001** by default (`wsgi.py`).

### Frontend

```bash
cd apps/frontend
npm install
npm run dev
```

Next.js runs on **port 3000** by default. Set `NEXT_PUBLIC_API_URL=http://localhost:5001` if your API port differs.

### GTFS data

Static schedules and shapes live under **`apps/backend/GTFS/`** (`routes.txt`, `stops.txt`, `trips.txt`, etc.). The backend loads this set **once at startup** into memory; update files and restart the server after changes.

**Keeping the schedule current.** MATA publishes only a rolling window of about three weeks, so the bundled files go stale quickly. Refresh them from MATA's official feed, then commit and redeploy the backend:

```bash
cd apps/backend
python scripts/update_gtfs.py
```

This also runs automatically: the **Refresh GTFS schedule** GitHub Action (`.github/workflows/refresh-gtfs.yml`) runs every Monday, downloads the feed, runs the backend tests against it, and commits any change to `main`. It can be run on demand from the repository's Actions tab. If the download or tests fail, nothing is committed and the run shows as failed.

If the bundle is past its date range, the planner keeps working by assuming the usual service for that day of the week (holiday exceptions from `calendar_dates.txt` only apply inside the range), plan responses carry `schedule_outdated: true`, and the UI shows a warning. `GET /api/schedule/status` reports the covered dates.

---

## API overview (backend)

- `GET /` — Health-style JSON.
- `GET /api/vehicles` — Vehicles with GTFS enrichment, plus `source`: `live`, `unavailable`, or `mock`.
- `GET /api/stops`, `/api/routes`, `/api/plan`, `/api/plan/walk`, `/api/shapes/<id>`, `/api/routes/<id>/stops`, `/api/next_departures`, `/api/schedule/status` — GTFS-backed planning and geometry.
- `GET|POST /api/reports` — List/create accessibility reports (MongoDB).
- `POST /api/reports/<id>/vote`, `GET /api/reports/ai-note`, `POST /api/reports/analyze-image`, `POST /api/reports/upload-image`, `GET /api/reports/images/<id>` — Extras (some require OpenRouter and/or MongoDB).
- `GET /api/admin/reports`, `POST|DELETE /api/admin/reports/<id>/resolve` — Admin queue.

---

## Deployment notes

- Free showcase path: **two Vercel projects** — `apps/frontend` (Next.js) and `apps/backend` (Python via `vercel.json`). Set `NEXT_PUBLIC_API_URL` on the frontend to the backend URL and **redeploy** so it is baked into the build.
- Production can also use **`gunicorn`** (listed in `requirements.txt`) in front of the Flask app; configure MongoDB and env vars in that environment.

---

## Development tooling (backend)

```bash
pip install -r requirements-dev.txt
```

Includes **pytest**, **black**, and **ruff** for tests and formatting.

---

## Disclaimer

This is an independent project and is **not** affiliated with or endorsed by MATA. Verify schedules and real-time data against official sources before relying on them for travel.
