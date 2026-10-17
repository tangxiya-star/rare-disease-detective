# Frontend

React + Vite workspace: patient & motion panel, runtime agent tree (React Flow), evidence inspector, and event / evidence / report tabs. Talks to the backend through the Vite proxy (`/api` → `localhost:8000`); contract in [docs/EVENTS.md](../docs/EVENTS.md).

```bash
# terminal 1
cd backend && uv run uvicorn app.main:app --port 8000
# terminal 2
cd frontend && npm install && npm run dev   # http://localhost:5173
```

`?run=<run_id>` reopens a run (events replay from the start). Add `&slot=01&mode=demo` to pick the case.
A **MOCK MODEL** badge in the header means the backend is on scripted answers, not Nemotron.
