"""Recorded runs: a finished run exported verbatim (every row of every table, every event with
its original timestamp) to recordings/*.json, and imported into the DB at startup.

The demo replays a real Crusoe run from its own event log instead of running live, so it fits
the time slot and survives a backend restart. Nothing is edited: the file is the DB rows.
"""

import json
from pathlib import Path

from .config import REPO_ROOT
from .db import DB

RECORDINGS = REPO_ROOT / "recordings"
TABLES = ("runs", "nodes", "evidence", "sources", "events")


def _key(table: str) -> str:
    return "id" if table == "runs" else "run_id"


def export_run(db: DB, run_id: str, label: str) -> dict:
    run = db.query("SELECT * FROM runs WHERE id = ?", (run_id,))
    if not run:
        raise KeyError(run_id)
    if run[0]["status"] != "completed":
        raise ValueError(f"{run_id} is {run[0]['status']}; only completed runs can be recorded")
    rows = {t: db.query(f"SELECT * FROM {t} WHERE {_key(t)} = ?", (run_id,)) for t in TABLES}
    ts = [e["ts"] for e in rows["events"]]
    return {"run_id": run_id, "label": label, "llm_backend": run[0]["llm_backend"],
            "slot": run[0]["slot"], "mode": run[0]["mode"],
            "recorded_at": min(ts), "duration_s": round(max(ts) - min(ts), 1), "rows": rows}


def import_recordings(db: DB, folder: Path = RECORDINGS) -> list[dict]:
    """Insert every recording whose run is not in the DB yet. Returns the index of all recordings."""
    index = []
    for path in sorted(folder.glob("*.json")):
        rec = json.loads(path.read_text())
        if not db.query("SELECT 1 FROM runs WHERE id = ?", (rec["run_id"],)):
            for table in TABLES:
                for row in rec["rows"][table]:
                    cols = ", ".join(row)
                    marks = ", ".join("?" for _ in row)
                    db.execute(f"INSERT OR IGNORE INTO {table} ({cols}) VALUES ({marks})", tuple(row.values()))
        index.append({k: rec[k] for k in ("run_id", "label", "llm_backend", "slot", "mode",
                                          "recorded_at", "duration_s")})
    return index
