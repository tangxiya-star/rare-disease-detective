"""HTTP + WebSocket API. Run with: uv run uvicorn app.main:app --reload (from backend/)."""

import asyncio
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .cases import list_cases, load_case
from .config import load_settings
from .db import DB
from .events import EventBus
from .llm import make_llm
from .orchestrator import Orchestrator, public_node

settings = load_settings()
state: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    db = DB(settings.db_path)
    bus = EventBus(db)
    state.update(db=db, bus=bus, orch=Orchestrator(settings, db, bus, make_llm(settings)))
    yield


app = FastAPI(title="Rare Disease Detective", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])

Mode = Literal["scored", "demo"]


class StartRun(BaseModel):
    slot: str
    mode: Mode = "demo"


class Inject(BaseModel):
    kind: Literal["agent_crash", "search_failure"]
    node_id: str | None = None


@app.get("/api/health")
def health():
    return {"ok": True, "llm_backend": state["orch"].llm.name, "search_backend": settings.search_backend,
            "lead_model": settings.lead_model, "child_model": settings.child_model}


@app.get("/api/cases")
def cases(mode: Mode = "demo"):
    return list_cases(mode)


@app.get("/api/cases/{slot}")
def case(slot: str, mode: Mode = "demo"):
    try:
        b = load_case(slot, mode)
    except KeyError:
        raise HTTPException(404, "case not found")
    return {"slot": slot, "mode": mode, "case": b.agent_view(), "annotations": b.annotations,
            "has_video": bool(b.video and b.video.exists()),
            "has_landmarks": bool(b.landmarks and b.landmarks.exists())}


@app.get("/api/cases/{slot}/video")
def case_video(slot: str, mode: Mode = "demo"):
    b = load_case(slot, mode)
    if not b.video or not b.video.exists():
        raise HTTPException(404, "video not available locally; see cases/README.md")
    # H.264 in a QuickTime container; browsers play it when labelled video/mp4.
    return FileResponse(b.video, media_type="video/mp4")


@app.get("/api/cases/{slot}/landmarks")
def case_landmarks(slot: str, mode: Mode = "demo"):
    """MediaPipe hand landmarks per video frame (motion coordinates only; not diagnostic)."""
    b = load_case(slot, mode)
    if not b.landmarks or not b.landmarks.exists():
        raise HTTPException(404, "no landmarks for this case")
    return FileResponse(b.landmarks, media_type="application/json")


@app.post("/api/runs")
async def start_run(body: StartRun):
    try:
        run_id = await state["orch"].start_run(body.slot, body.mode)
    except KeyError:
        raise HTTPException(404, "case not found")
    return {"run_id": run_id}


@app.get("/api/runs/{run_id}")
def get_run(run_id: str):
    db: DB = state["db"]
    run = db.get_run(run_id)
    if run is None:
        raise HTTPException(404, "run not found")
    return {"run": run, "nodes": [public_node(n) | {"artifact": n["artifact"]} for n in db.get_nodes(run_id)],
            "evidence": db.get_evidence(run_id), "sources": db.get_sources(run_id)}


@app.get("/api/runs/{run_id}/media/{gap_id}")
def released_media(run_id: str, gap_id: str):
    """Held-out media, served only after this run released the matching result."""
    db: DB = state["db"]
    run = db.get_run(run_id)
    if run is None:
        raise HTTPException(404, "run not found")
    released = [e for e in db.events_since(run_id) if e["type"] == "heldout.released"
                and e["data"]["gap_id"] == gap_id and e["data"].get("media")]
    if not released:
        raise HTTPException(403, "not released in this run")
    path = settings.repo_root / "cases" / "reference" / released[0]["data"]["media"]
    if not path.exists():
        raise HTTPException(404, "media not available locally")
    return FileResponse(path, media_type="video/mp4")


@app.post("/api/runs/{run_id}/inject")
def inject(run_id: str, body: Inject):
    if run_id not in state["orch"].runs:
        raise HTTPException(404, "run not active")
    state["orch"].inject(run_id, body.kind, body.node_id)
    return {"ok": True}


@app.post("/api/runs/{run_id}/resume")
async def resume(run_id: str):
    try:
        await state["orch"].resume_run(run_id)
    except KeyError:
        raise HTTPException(404, "run not found")
    return {"ok": True}


@app.websocket("/api/runs/{run_id}/events")
async def events(ws: WebSocket, run_id: str, after: int = 0):
    await ws.accept()
    bus: EventBus = state["bus"]
    q = bus.subscribe(run_id)
    try:
        last = after
        for e in state["db"].events_since(run_id, after):
            await ws.send_json(e)
            last = e["seq"]
        while True:
            e = await q.get()
            if e["seq"] > last:
                await ws.send_json(e)
                last = e["seq"]
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    finally:
        bus.unsubscribe(run_id, q)
