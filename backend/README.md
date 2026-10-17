# Backend

FastAPI orchestrator for runtime-driven recursive investigation. API and events: [docs/EVENTS.md](../docs/EVENTS.md).

```bash
cd backend
uv sync --python 3.11
uv run uvicorn app.main:app --reload --port 8000
uv run pytest -q
```

## Model backend

- No `CRUSOE_API_KEY` in the repo-root `.env` → **mock** model: scripted answers in the same JSON shapes, so the real orchestrator (validation, spawning, search, grounding, verification, checkpoints, events) runs end to end. Every mock output is tagged `[mock]`; never show it as clinical output.
- `CRUSOE_API_KEY` set → Nemotron on Crusoe (Super for lead, verifier and replanning; Nano for investigators). Force either with `LLM_BACKEND=mock|crusoe`.

## Search backend

`SEARCH_BACKEND=europepmc` (default, live, no key) or `fixture` (offline, used by tests). The demo case's `retrieval_blocklist` from `cases/manifest.json` is applied to every result.

## Layout

| File | Role |
|---|---|
| `app/cases.py` | Loader (manifest, agent view without reference or provenance) and held-out release rules |
| `app/orchestrator.py` | Lead / investigator / verifier loop, replanning, checkpoints, retry and recovery |
| `app/validator.py` | Spawn checks: depth, node budget, duplicates, scope |
| `app/grounding.py` | Verbatim quote and case finding id checks, in code |
| `app/search.py` | Europe PMC client, blocklist, reformulate → retry → alternative → unresolved |
| `app/llm.py`, `app/mock_llm.py`, `app/prompts.py` | Model clients and role prompts |
| `app/db.py`, `app/events.py` | SQLite state and the replayable event stream |
