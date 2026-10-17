"""SQLite persistence: runs, nodes, evidence, events. One connection, serialized by a lock.

Node rows hold the durable state the orchestrator needs to resume: status, the last
completed checkpoint, and `artifact` (JSON of everything produced so far).
"""

import json
import sqlite3
import threading
import time
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  slot TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  llm_backend TEXT NOT NULL,
  report TEXT,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  parent_id TEXT,
  depth INTEGER NOT NULL,
  role TEXT NOT NULL,
  model TEXT NOT NULL,
  objective TEXT NOT NULL,
  justification TEXT,
  status TEXT NOT NULL,
  checkpoint TEXT NOT NULL,
  verification TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  artifact TEXT NOT NULL DEFAULT '{}',
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS nodes_run ON nodes(run_id);
CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  claim TEXT NOT NULL,
  quote TEXT,
  source_id TEXT,
  finding_ids TEXT NOT NULL DEFAULT '[]',
  stance TEXT,
  hypothesis TEXT,
  grounded INTEGER NOT NULL,
  grounding_note TEXT,
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS sources (
  id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  title TEXT,
  url TEXT,
  text TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (run_id, id)
);
CREATE TABLE IF NOT EXISTS events (
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ts REAL NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);
"""

NODE_JSON_FIELDS = ("artifact",)


class DB:
    def __init__(self, path: Path | str):
        self.conn = sqlite3.connect(str(path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self.lock = threading.Lock()

    def execute(self, sql: str, params: tuple = ()) -> None:
        with self.lock:
            self.conn.execute(sql, params)
            self.conn.commit()

    def query(self, sql: str, params: tuple = ()) -> list[dict]:
        with self.lock:
            return [dict(r) for r in self.conn.execute(sql, params).fetchall()]

    # runs
    def create_run(self, run_id: str, slot: str, mode: str, llm_backend: str) -> None:
        now = time.time()
        self.execute("INSERT INTO runs VALUES (?,?,?,?,?,?,?,?)",
                     (run_id, slot, mode, "running", llm_backend, None, now, now))

    def update_run(self, run_id: str, **fields) -> None:
        if "report" in fields and fields["report"] is not None:
            fields["report"] = json.dumps(fields["report"])
        sets = ", ".join(f"{k}=?" for k in fields)
        self.execute(f"UPDATE runs SET {sets}, updated_at=? WHERE id=?",
                     (*fields.values(), time.time(), run_id))

    def get_run(self, run_id: str) -> dict | None:
        rows = self.query("SELECT * FROM runs WHERE id=?", (run_id,))
        if not rows:
            return None
        run = rows[0]
        run["report"] = json.loads(run["report"]) if run["report"] else None
        return run

    # nodes
    def insert_node(self, node: dict) -> None:
        now = time.time()
        self.execute(
            "INSERT INTO nodes (id, run_id, parent_id, depth, role, model, objective, justification, status,"
            " checkpoint, verification, retry_count, attempts, artifact, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (node["id"], node["run_id"], node["parent_id"], node["depth"], node["role"], node["model"],
             node["objective"], node.get("justification"), node["status"], node["checkpoint"],
             node["verification"], 0, 0, json.dumps(node.get("artifact", {})), now, now))

    def update_node(self, node_id: str, **fields) -> None:
        for k in NODE_JSON_FIELDS:
            if k in fields:
                fields[k] = json.dumps(fields[k])
        sets = ", ".join(f"{k}=?" for k in fields)
        self.execute(f"UPDATE nodes SET {sets}, updated_at=? WHERE id=?", (*fields.values(), time.time(), node_id))

    def get_nodes(self, run_id: str) -> list[dict]:
        rows = self.query("SELECT * FROM nodes WHERE run_id=? ORDER BY created_at", (run_id,))
        for r in rows:
            r["artifact"] = json.loads(r["artifact"])
        return rows

    def get_node(self, node_id: str) -> dict:
        r = self.query("SELECT * FROM nodes WHERE id=?", (node_id,))[0]
        r["artifact"] = json.loads(r["artifact"])
        return r

    # evidence and sources
    def insert_evidence(self, ev: dict) -> None:
        self.execute(
            "INSERT INTO evidence VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (ev["id"], ev["run_id"], ev["node_id"], ev["kind"], ev["claim"], ev.get("quote"), ev.get("source_id"),
             json.dumps(ev.get("finding_ids", [])), ev.get("stance"), ev.get("hypothesis"),
             1 if ev["grounded"] else 0, ev.get("grounding_note"), time.time()))

    def get_evidence(self, run_id: str) -> list[dict]:
        rows = self.query("SELECT * FROM evidence WHERE run_id=? ORDER BY created_at", (run_id,))
        for r in rows:
            r["finding_ids"] = json.loads(r["finding_ids"])
            r["grounded"] = bool(r["grounded"])
        return rows

    def upsert_source(self, run_id: str, src: dict) -> None:
        self.execute("INSERT OR REPLACE INTO sources VALUES (?,?,?,?,?,?)",
                     (src["id"], run_id, src.get("title"), src.get("url"), src["text"],
                      json.dumps(src.get("meta", {}))))

    def get_sources(self, run_id: str) -> list[dict]:
        rows = self.query("SELECT * FROM sources WHERE run_id=?", (run_id,))
        for r in rows:
            r["meta"] = json.loads(r["meta"])
        return rows

    # events
    def append_event(self, run_id: str, type_: str, data: dict) -> dict:
        with self.lock:
            cur = self.conn.execute("SELECT COALESCE(MAX(seq), 0) + 1 FROM events WHERE run_id=?", (run_id,))
            seq = cur.fetchone()[0]
            ts = time.time()
            self.conn.execute("INSERT INTO events VALUES (?,?,?,?,?)", (run_id, seq, ts, type_, json.dumps(data)))
            self.conn.commit()
        return {"run_id": run_id, "seq": seq, "ts": ts, "type": type_, "data": data}

    def events_since(self, run_id: str, after_seq: int = 0) -> list[dict]:
        rows = self.query("SELECT * FROM events WHERE run_id=? AND seq>? ORDER BY seq", (run_id, after_seq))
        for r in rows:
            r["data"] = json.loads(r["data"])
        return rows
